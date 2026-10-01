/**
 * 주관 키워드 라벨링 + 조합 검색 도구. node keyword-server.mjs → http://localhost:3001
 * 라벨은 keyword_labels.json에 저장된다: { "<키워드 id>": { "<핀 id>": 2(맞아) | 1(애매) | 0(아니야) } }
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { KEYWORDS, parseQuery, addCustomKeyword, addLearnedSynonym } from './keywords.mjs';
import { interpretTerms, aiEnabled } from './keyword-ai.mjs';
import { SUBJECTS, parseSubjects } from './subjects.mjs';
import { MODELS, loadTextEncoder, normalize } from './models.mjs';
import { loadKeywordModel, scoreKeyword, searchKeywords, YES, MAYBE, NO } from './keyword-rank.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES = path.join(__dirname, '..', '..', 'images');
const LABELS = path.join(__dirname, 'keyword_labels.json');
const PORT = 3001;

const model = loadKeywordModel();
const labels = fs.existsSync(LABELS) ? JSON.parse(fs.readFileSync(LABELS, 'utf8')) : {};
const saveLabels = () => fs.writeFileSync(LABELS, JSON.stringify(labels, null, 1));
const VECTORS = path.join(__dirname, 'out', 'keyword_vectors.json');
// 주제 확률 (build-subjects.mjs가 만든다): 핀이 그 주제 기준선 이상이면 "그 주제가 있는 사진"
const subjectScores = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'subject_scores.json'), 'utf8'));
const hasSubject = (subjectId, pin) => subjectScores[subjectId][pin] >= SUBJECTS.find((s) => s.id === subjectId).threshold;
const subjectKo = (id) => SUBJECTS.find((s) => s.id === id).ko;

// 단어 감각 테스트 (신규 가입자 시뮬레이션). 결과는 이름별로 test_profiles/<이름>.json에 저장된다
const PROFILES = path.join(__dirname, 'test_profiles');
const safeName = (name) => String(name ?? '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 20);
const loadProfile = (name) => {
    const file = path.join(PROFILES, `${safeName(name)}.json`);
    return safeName(name) && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
// "차가운은" / "매끈한은" / "이쁜은" 처럼 받침에 맞는 조사
const topicParticle = (word) => {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    return code >= 0 && code <= 11171 && code % 28 !== 0 ? '은' : '는';
};

/**
 * 테스트 답 → 라벨과 감각 프로필.
 * 답: { keyword, pair(문제 번호), choice: 'left' | 'right' | 'both' | 'neither' }
 * 고른 쪽 = 맞아, 안 고른 쪽 = 아니야. 무리별 득점으로 "당신의 ○○은 △△ 쪽" 문장을 만든다.
 */
function scoreTest(answers) {
    const testSet = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'test_set.json'), 'utf8'));
    const marks = {};
    const summary = [];
    for (const k of testSet) {
        const points = k.clusters.map(() => 0);
        let neither = 0;
        marks[k.id] = {};
        answers.filter((a) => a.keyword === k.id).forEach((a) => {
            const pair = k.pairs[a.pair];
            if (!pair) return;
            const value = (side) => (a.choice === 'both' || a.choice === side ? YES : NO);
            marks[k.id][pair.left.pin] = value('left');
            marks[k.id][pair.right.pin] = value('right');
            if (a.choice === 'neither') neither++;
            if (a.choice === 'left' || a.choice === 'both') points[pair.left.cluster] += a.choice === 'both' ? 0.5 : 1;
            if (a.choice === 'right' || a.choice === 'both') points[pair.right.cluster] += a.choice === 'both' ? 0.5 : 1;
        });
        const best = Math.max(...points);
        const winners = k.clusters.filter((_, i) => points[i] === best && best > 0).map((c) => c.label);
        const subject = `당신의 '${k.ko}'${topicParticle(k.ko)}`;
        const sentence = neither >= 2 || !winners.length ? `${subject} AI가 생각한 것과 많이 달라요`
            : winners.length === 1 ? `${subject} ${winners[0]} 쪽이에요`
                : `${subject} ${winners.join('·')} 사이 어딘가예요`;
        summary.push({ keyword: k.ko, sentence });
    }
    return { marks, summary };
}

// 텍스트 모델은 무거워서(SigLIP 2 약 1.1GB) AI가 새 키워드를 만들 때 처음 한 번만 불러온다
let encoders = null;
async function getEncoders() {
    encoders ??= Promise.all(Object.keys(MODELS).map(async (m) => [m, await loadTextEncoder(m)])).then(Object.fromEntries);
    return encoders;
}

/** AI가 제안한 새 키워드를 등록한다: 영어 묘사로 모델별 시작점을 계산하고, 사전과 벡터 파일에 저장 */
async function createKeyword(term, stem, proposal) {
    const id = `custom_${Date.now().toString(36)}`;
    const enc = await getEncoders();
    model.starts[id] = {};
    for (const [name, encode] of Object.entries(enc)) {
        const vecs = await Promise.all(proposal.expansions.map(encode));
        const sum = new Float32Array(vecs[0].length);
        vecs.forEach((v) => v.forEach((x, i) => { sum[i] += x; }));
        model.starts[id][name] = Array.from(normalize(sum));
    }
    fs.writeFileSync(VECTORS, JSON.stringify(model.starts));
    const synonyms = [...new Set([stem, ...proposal.synonyms].map((x) => x.trim()).filter(Boolean))];
    addCustomKeyword({ id, ko: proposal.ko, group: 'custom', synonyms, expansions: proposal.expansions, createdFrom: term });
    return id;
}

function send(res, status, body, type = 'application/json') {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function counts(id) {
    const values = Object.values(labels[id] ?? {});
    return { yes: values.filter((v) => v === YES).length, maybe: values.filter((v) => v === MAYBE).length, no: values.filter((v) => v === NO).length };
}

/**
 * 검색: 사전으로 키워드를 찾고, ai=1이면 사전에 없는 말을 Claude에게 해석시켜 키워드를 보탠다.
 * AI가 기존 키워드에 연결한 말은 어간을 비슷한 말로 등록하고, 새 느낌이면 새 키워드를 만든다.
 */
async function handleSearch(url, res) {
    // 주제어("옷", "사람 없는")를 먼저 떼어내고, 나머지에서 느낌 키워드를 찾는다
    const subjects = parseSubjects(url.searchParams.get('q') ?? '');
    const toggled = (url.searchParams.get('exclude') ?? '').split(',').filter((id) => SUBJECTS.some((s) => s.id === id));
    const include = subjects.include;
    const exclude = [...new Set([...subjects.exclude, ...toggled])].filter((id) => !include.includes(id));
    const { ids, unknown } = parseQuery(subjects.rest);
    let interpretations = [];
    if (unknown.length && url.searchParams.get('ai') === '1') {
        interpretations = await interpretTerms(unknown);
        for (const r of interpretations) {
            if (r.kind === 'mapped') {
                r.keywordIds.forEach((id) => { addLearnedSynonym(id, r.stem || r.term); if (!ids.includes(id)) ids.push(id); });
            } else if (r.kind === 'new' && r.newKeyword) {
                // 같은 말로 이미 만든 키워드가 있으면 재사용 (서버 재시작 전 캐시된 응답 대비)
                const existing = KEYWORDS.find((k) => k.createdFrom === r.term);
                const id = existing?.id ?? await createKeyword(r.term, r.stem || r.term, r.newKeyword);
                r.keywordIds = [id];
                if (!ids.includes(id)) ids.push(id);
            }
        }
    }
    const ko = (id) => KEYWORDS.find((k) => k.id === id).ko;
    const allowed = (pin) => include.every((s) => hasSubject(s, pin)) && !exclude.some((s) => hasSubject(s, pin));
    let pins = [];
    if (ids.length) {
        // profile이 있으면 그 사람의 테스트 결과를 라벨로 쓴다 (신규 가입자처럼 - 내 라벨링은 쓰지 않음)
        const profile = loadProfile(url.searchParams.get('profile'));
        pins = searchKeywords(model, ids, profile ? profile.marks : labels, 60, allowed);
    } else if (include.length) {
        // 느낌 키워드 없이 주제만 쓴 경우 ("옷") - 그 주제가 확실한 순서대로
        pins = model.uniqueIds.filter(allowed)
            .map((id) => ({ id, score: Math.min(...include.map((s) => subjectScores[s][id])), each: [] }))
            .sort((a, b) => b.score - a.score).slice(0, 60);
    }
    const body = {
        aiEnabled,
        include: include.map(subjectKo),
        exclude: exclude.map(subjectKo),
        keywords: ids.map(ko),
        unknown: interpretations.length ? [] : unknown,
        interpretations: interpretations.map((r) => ({ term: r.term, kind: r.kind, keywords: r.keywordIds.map(ko), reason: r.reason })),
        pins
    };
    send(res, 200, body);
}

http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/') {
        return send(res, 200, fs.readFileSync(path.join(__dirname, 'keyword.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/test') {
        return send(res, 200, fs.readFileSync(path.join(__dirname, 'test.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/test') {
        const testSet = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'test_set.json'), 'utf8'));
        return send(res, 200, testSet.map((k) => ({ id: k.id, ko: k.ko, pairs: k.pairs.map((p) => [p.left.pin, p.right.pin]) })));
    }
    if (req.method === 'POST' && url.pathname === '/api/test/result') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const { name, answers } = JSON.parse(body);
            if (!safeName(name)) return send(res, 400, { error: '이름이 필요해요' });
            const { marks, summary } = scoreTest(answers);
            fs.mkdirSync(PROFILES, { recursive: true });
            fs.writeFileSync(path.join(PROFILES, `${safeName(name)}.json`),
                JSON.stringify({ name: safeName(name), createdAt: new Date().toISOString(), answers, marks, summary }, null, 1));
            send(res, 200, { name: safeName(name), summary });
        });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/subjects') {
        return send(res, 200, SUBJECTS.map((s) => ({ id: s.id, ko: s.ko, count: model.uniqueIds.filter((pin) => hasSubject(s.id, pin)).length })));
    }
    if (req.method === 'GET' && url.pathname === '/api/keywords') {
        return send(res, 200, KEYWORDS.map((k) => ({ id: k.id, ko: k.ko, group: k.group ?? 'mine', synonyms: k.synonyms, ...counts(k.id) })));
    }
    // 라벨링할 다음 묶음: 지금까지의 라벨로 학습한 순위에서, 아직 라벨이 없는 상위 n장
    // view=labeled 이면 이미 라벨 붙인 사진을 다시 보여준다 (수정용)
    if (req.method === 'GET' && url.pathname === '/api/batch') {
        const id = url.searchParams.get('kw');
        if (!KEYWORDS.some((k) => k.id === id)) return send(res, 400, { error: '알 수 없는 키워드' });
        const marks = labels[id] ?? {};
        const n = Math.min(parseInt(url.searchParams.get('n'), 10) || 40, 200);
        const scores = scoreKeyword(model, id, marks);
        const ranked = model.uniqueIds.map((pin) => ({ id: pin, score: scores.get(pin), mark: marks[pin] }))
            .sort((a, b) => b.score - a.score);
        const pins = url.searchParams.get('view') === 'labeled'
            ? ranked.filter((p) => p.mark !== undefined)
            : ranked.filter((p) => p.mark === undefined).slice(0, n);
        return send(res, 200, { pins, ...counts(id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/label') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            const { kw, marks } = JSON.parse(body); // marks: { 핀 id: 값 | null(지우기) }
            labels[kw] ??= {};
            Object.entries(marks).forEach(([pin, v]) => { if (v === null) delete labels[kw][pin]; else labels[kw][pin] = v; });
            saveLabels();
            send(res, 200, counts(kw));
        });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/search') {
        return handleSearch(url, res).catch((error) => {
            console.error('검색 실패:', error);
            send(res, 500, { error: '검색 실패' });
        });
    }
    const image = url.pathname.match(/^\/images\/(\d+\.jpg)$/);
    if (req.method === 'GET' && image) {
        const file = path.join(IMAGES, image[1]);
        if (fs.existsSync(file)) {
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' });
            return fs.createReadStream(file).pipe(res);
        }
    }
    send(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`키워드 도구: http://localhost:${PORT}`));
