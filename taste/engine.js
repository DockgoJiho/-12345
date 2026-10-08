/**
 * 감각 검색 엔진 (사이트 서버용).
 * experiments/embedding-compare에서 만든 결과(taste/data, export-taste.mjs가 내보냄)만 읽어서 동작한다 -
 * 이미지·텍스트 AI 모델은 여기서 돌리지 않는다. 검색에 필요한 건 미리 계산해 둔 이미지 임베딩과 키워드 시작점뿐이다.
 *
 * - 느낌 키워드: 키워드마다 "AI 기본 해석"에서 출발해, 그 사람이 "맞아"한 사진 쪽으로 당기고 "아니야"한 사진에서 밀어낸
 *   방향으로 전체 핀을 채점한다. 두 모델(CLIP, SigLIP 2)의 점수를 각각 표준화해 평균낸다.
 * - 조합 검색: 모든 키워드를 만족해야 하므로 핀마다 가장 약한 키워드 점수를 그 핀의 점수로 쓴다.
 * - 주제(사람, 옷, 포스터 …): 미리 계산한 주제 확률이 기준선 이상이면 그 주제가 있는 사진으로 본다.
 * - 기준(marks)은 { 키워드 id: { 핀 id: 2(맞아) | 1(애매) | 0(아니야) } } - 아카이브 주인의 라벨이나 단어 감각 테스트 결과.
 */
const fs = require('fs');
const path = require('path');
const SearchCore = require('../search-core');

const DATA = path.join(__dirname, 'data');
const MODELS = ['clip', 'siglip2'];
const YES = 2, NO = 0;
const POSITIVE_WEIGHT = 1.0;
const NEGATIVE_WEIGHT = 0.5;

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));

function loadIndex(name) {
    const { dim, ids } = readJson(`${name}.ids.json`);
    const buf = fs.readFileSync(path.join(DATA, `${name}.bin`));
    const data = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    return { dim, ids, data, rowOf: new Map(ids.map((id, i) => [id, i])) };
}

const indexes = Object.fromEntries(MODELS.map((m) => [m, loadIndex(m)]));
const canonicalOf = readJson('duplicates.json');
// 거의 같은 이미지는 대표 핀 하나만 결과에 남긴다
const uniqueIds = indexes.siglip2.ids.filter((id) => canonicalOf[id] === id);
const starts = readJson('keyword_vectors.json');
const KEYWORDS = readJson('keywords.json');
const SUBJECTS = readJson('subjects.json');
const subjectScores = readJson('subject_scores.json');
const testSet = readJson('test_set.json');
const ownerLabels = readJson('owner_labels.json');

function normalize(v) {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    const n = Math.sqrt(sum) || 1;
    return v.map((x) => x / n);
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const vecAt = (index, row) => index.data.subarray(row * index.dim, (row + 1) * index.dim);

function zscore(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
    return values.map((v) => (v - mean) / sd);
}

// 맞아·아니야가 각각 이만큼 있으면 경계를 직접 학습하는 분류기를 쓴다 (그보다 적으면 평균 방향)
const CLASSIFIER_MIN_LABELS = 5;
const PRIOR_WEIGHT = 0.5;

/**
 * 맞아(1)/아니야(0)를 가르는 경계를 학습한다 (L2 정규화 로지스틱 회귀, 경사하강).
 * 두 클래스는 장수와 상관없이 같은 비중으로 다룬다. 반환: 임베딩 공간의 방향 w (점수 = w·x)
 */
function trainClassifier(dim, yesVecs, noVecs) {
    const X = [...yesVecs, ...noVecs];
    const y = [...yesVecs.map(() => 1), ...noVecs.map(() => 0)];
    const weight = [...yesVecs.map(() => 0.5 / yesVecs.length), ...noVecs.map(() => 0.5 / noVecs.length)];
    const w = new Float32Array(dim);
    let bias = 0;
    const RATE = 2.0, L2 = 0.01, SCALE = 10; // 임베딩끼리의 유사도 차이가 작아서 SCALE배로 키워 학습한다
    for (let it = 0; it < 300; it++) {
        const grad = new Float32Array(dim);
        let gradBias = 0;
        X.forEach((x, n) => {
            const p = 1 / (1 + Math.exp(-(dot(w, x) * SCALE + bias)));
            const e = (p - y[n]) * weight[n];
            for (let d = 0; d < dim; d++) grad[d] += e * x[d] * SCALE;
            gradBias += e;
        });
        for (let d = 0; d < dim; d++) w[d] -= RATE * (grad[d] + L2 * w[d]);
        bias -= RATE * gradBias;
    }
    return w;
}

/**
 * 키워드 하나에 대한 전체 핀 점수 (핀 id → 표준화 점수).
 * - 맞아·아니야가 충분하면: 그 사람의 경계를 학습한 분류기 점수 + AI 기본 해석 점수(절반 비중)
 *   (실험: 학습에 안 쓴 사진 기준 일치도 평균 0.70 → 0.92, experiments/embedding-compare/holdout.mjs)
 * - 적으면: AI 기본 해석에서 출발해 맞아 쪽으로 당기고 아니야에서 밀어낸 방향 하나
 */
function scoreKeyword(keywordId, marks = {}) {
    const fused = new Map();
    for (const name of MODELS) {
        const index = indexes[name];
        const start = Float32Array.from(starts[keywordId][name]);
        const rowsWith = (value) => Object.entries(marks)
            .filter(([, v]) => v === value)
            .map(([pin]) => index.rowOf.get(pin))
            .filter((r) => r !== undefined);
        const yesVecs = rowsWith(YES).map((r) => vecAt(index, r));
        const noVecs = rowsWith(NO).map((r) => vecAt(index, r));
        const all = index.ids.map((_, i) => vecAt(index, i));

        let scores;
        if (yesVecs.length >= CLASSIFIER_MIN_LABELS && noVecs.length >= CLASSIFIER_MIN_LABELS) {
            const w = trainClassifier(index.dim, yesVecs, noVecs);
            const learned = zscore(all.map((x) => dot(x, w)));
            const prior = zscore(all.map((x) => dot(x, start)));
            scores = learned.map((s, i) => s + PRIOR_WEIGHT * prior[i]);
        } else {
            const query = Float32Array.from(start);
            const pull = (vecs, weight) => vecs.forEach((v) => {
                for (let d = 0; d < index.dim; d++) query[d] += weight * v[d] / vecs.length;
            });
            pull(yesVecs, POSITIVE_WEIGHT);
            pull(noVecs, -NEGATIVE_WEIGHT);
            const q = normalize(query);
            scores = all.map((x) => dot(x, q));
        }
        zscore(scores).forEach((z, i) => fused.set(index.ids[i], (fused.get(index.ids[i]) ?? 0) + z / MODELS.length));
    }
    return fused;
}

// ── 검색어 해석 ───────────────────────────────────────────────

// 검색어 해석은 브라우저와 같은 코드를 쓴다 (search-core.js)
const { parseSubjects, parseKeywords } = SearchCore.createQueryParser({ keywords: KEYWORDS, subjects: SUBJECTS });

// 아카이브 주인의 기준은 바뀌지 않으므로 키워드별 점수를 한 번만 계산해 둔다
const ownerScoreCache = new Map();
const ownerScore = (id) => {
    if (!ownerScoreCache.has(id)) ownerScoreCache.set(id, scoreKeyword(id, ownerLabels[id]));
    return ownerScoreCache.get(id);
};
// 라벨이 없는 사람(다른 사용자)은 AI 기본 해석 그대로 - 이것도 바뀌지 않으므로 한 번만 계산한다
const aiScoreCache = new Map();
const aiScore = (id) => {
    if (!aiScoreCache.has(id)) aiScoreCache.set(id, scoreKeyword(id, {}));
    return aiScoreCache.get(id);
};
const hasLabels = (labels) => !!labels && Object.keys(labels).length > 0;

// 이미지 분석이 안 된 핀(임베딩에 없는 핀)은 어떤 주제도 없는 것으로 본다
const hasSubject = (subjectId, pin) => (subjectScores[subjectId][pin] ?? 0) >= SUBJECTS.find((s) => s.id === subjectId).threshold;
const isAnalyzed = (pin) => indexes.siglip2.rowOf.has(pin);
const keywordKo = (id) => KEYWORDS.find((k) => k.id === id).ko;
const subjectKo = (id) => SUBJECTS.find((s) => s.id === id).ko;

/**
 * 검색. marks가 없으면 아카이브 주인의 라벨을 기준으로 쓴다.
 * excludeToggles: 화면의 제외 버튼으로 끈 주제 id들
 * candidates: 이 핀 id(Pinterest 원본 id)들 안에서만 찾는다 - 터널 주인의 핀만 대상으로 할 때
 */
function search(query, { excludeToggles = [], marks = null, limit = 60, candidates = null } = {}) {
    const subjects = parseSubjects(String(query ?? ''));
    const include = subjects.include;
    const validToggles = excludeToggles.filter((id) => SUBJECTS.some((s) => s.id === id));
    const exclude = [...new Set([...subjects.exclude, ...validToggles])].filter((id) => !include.includes(id));
    const { ids, unknown } = parseKeywords(subjects.rest);
    const criteria = marks ?? ownerLabels;
    // 그 사람이 이 키워드에 직접 '아니야'라고 한 사진은 결과에서 뺀다 (점수로 밀어내는 것만으로는 남는 경우가 있다)
    const rejected = new Set(ids.flatMap((id) => Object.entries(criteria[id] ?? {}).filter(([, v]) => v === NO).map(([pin]) => pin)));
    const allowed = (pin) => (!candidates || candidates.has(pin)) && !rejected.has(pin)
        && include.every((s) => hasSubject(s, pin)) && !exclude.some((s) => hasSubject(s, pin));

    let pins = [];
    if (ids.length) {
        const perKeyword = ids.map((id) => {
            if (!marks) return ownerScore(id);
            return hasLabels(criteria[id]) ? scoreKeyword(id, criteria[id]) : aiScore(id);
        });
        pins = uniqueIds.filter(allowed)
            .map((id) => { const each = perKeyword.map((m) => m.get(id)); return { id, score: Math.min(...each), each }; })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    } else if (include.length) {
        // 느낌 키워드 없이 주제만 쓴 경우 ("옷") - 그 주제가 확실한 순서대로
        pins = uniqueIds.filter(allowed)
            .map((id) => ({ id, score: Math.min(...include.map((s) => subjectScores[s][id])), each: [] }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
    return {
        includeIds: include,
        excludeIds: exclude,
        include: include.map(subjectKo),
        exclude: exclude.map(subjectKo),
        keywords: ids.map(keywordKo),
        unknown,
        pins: pins.map((p) => ({ id: p.id, score: p.score, each: p.each }))
    };
}

/**
 * 브라우저가 보낸 테스트 결과(marks)를 믿을 수 있는 모양으로 거른다.
 * 알려진 키워드·핀과 0/1/2 값만 남기고, 키워드당 최대 200장까지만 받는다.
 */
function sanitizeMarks(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const clean = {};
    for (const k of KEYWORDS) {
        const entries = Object.entries(raw[k.id] ?? {})
            .filter(([pin, v]) => indexes.siglip2.rowOf.has(pin) && [0, 1, 2].includes(v))
            .slice(0, 200);
        if (entries.length) clean[k.id] = Object.fromEntries(entries);
    }
    return clean;
}

// ── 단어 감각 테스트 ──────────────────────────────────────────

const testQuestions = () => testSet.map((k) => ({ id: k.id, ko: k.ko, pairs: k.pairs.map((p) => [p.left.pin, p.right.pin]) }));

// "차가운은" / "이쁜은" 처럼 받침에 맞는 조사
const topicParticle = (word) => {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    return code >= 0 && code <= 11171 && code % 28 !== 0 ? '은' : '는';
};

/**
 * 테스트 답 → 기준(marks)과 감각 프로필 문장.
 * 답: { keyword, pair(문제 번호), choice: 'left' | 'right' | 'both' | 'neither' }
 * 고른 쪽 = 맞아, 안 고른 쪽 = 아니야. 사진 무리별 득점으로 "당신의 ○○은 △△ 쪽" 문장을 만든다.
 */
function scoreTest(answers) {
    const marks = {};
    const summary = [];
    for (const k of testSet) {
        const points = k.clusters.map(() => 0);
        let neither = 0;
        marks[k.id] = {};
        (Array.isArray(answers) ? answers : []).filter((a) => a && a.keyword === k.id).forEach((a) => {
            const pair = k.pairs[a.pair];
            if (!pair || !['left', 'right', 'both', 'neither'].includes(a.choice)) return;
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

/** 검색창 자동완성용: 느낌 키워드와 주제, 각각 알아듣는 표현들 */
const vocabulary = () => ({
    keywords: KEYWORDS.map((k) => ({ id: k.id, ko: k.ko, synonyms: k.synonyms })),
    subjects: SUBJECTS.map((s) => ({ id: s.id, ko: s.ko, synonyms: s.synonyms }))
});

/**
 * 브라우저가 받아 가서 직접 검색하는 "핀 × 느낌 키워드 점수표".
 * basis: 'owner' (기본 아카이브 주인의 라벨 기준) | 'ai' (AI 기본 해석 - 다른 사용자)
 * 점수는 z점수×1000(Int16), 주제 확률은 ×65535(Uint16)로 줄여서 base64로 보낸다.
 */
const feelTableCache = new Map();
const toBase64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
function feelTable(basis) {
    if (feelTableCache.has(basis)) return feelTableCache.get(basis);
    const ids = indexes.siglip2.ids;
    const scoreOf = basis === 'owner' ? ownerScore : aiScore;
    const scores = {};
    KEYWORDS.forEach((k) => {
        const byPin = scoreOf(k.id);
        scores[k.id] = toBase64(Int16Array.from(ids, (id) => Math.max(-32767, Math.min(32767, Math.round((byPin.get(id) ?? -30) * 1000)))));
    });
    const subjects = {}, thresholds = {};
    SUBJECTS.forEach((sub) => {
        subjects[sub.id] = toBase64(Uint16Array.from(ids, (id) => Math.round(Math.min(Math.max(subjectScores[sub.id][id] ?? 0, 0), 1) * 65535)));
        thresholds[sub.id] = sub.threshold;
    });
    // 그 사람이 이 키워드에 직접 '아니야'라고 한 사진은 결과에서 뺀다
    const rejected = {};
    if (basis === 'owner') {
        Object.entries(ownerLabels).forEach(([k, labels]) => {
            const no = Object.entries(labels).filter(([, v]) => v === NO).map(([pin]) => pin);
            if (no.length) rejected[k] = no;
        });
    }
    const uniqueRowSet = new Set(uniqueIds);
    const table = {
        version: DATA_VERSION,
        ids,
        unique: ids.map((id, i) => (uniqueRowSet.has(id) ? i : -1)).filter((i) => i >= 0),
        labels: {
            keywords: Object.fromEntries(KEYWORDS.map((k) => [k.id, k.ko])),
            subjects: Object.fromEntries(SUBJECTS.map((sub) => [sub.id, sub.ko]))
        },
        scores,
        subjects,
        thresholds,
        rejected
    };
    feelTableCache.set(basis, table);
    return table;
}

// 데이터를 다시 내보내면(export-taste.mjs) 바뀌는 값 - 브라우저가 옛 점수표를 캐시에서 계속 쓰지 않게 주소에 붙인다
const DATA_VERSION = String(Math.max(...fs.readdirSync(DATA).map((f) => fs.statSync(path.join(DATA, f)).mtimeMs)) | 0);

/**
 * 키워드 점수와 점수표를 조금씩 나눠 미리 계산한다 (한 번에 다 하면 그동안 서버가 다른 요청을 못 받는다).
 * 무료 서버에서 처음 계산하면 키워드 하나에 수십~수백 ms라, 사람이 오기 전에 끝내 둔다.
 */
function warmUp() {
    const pending = KEYWORDS.flatMap((k) => [() => ownerScore(k.id), () => aiScore(k.id)]);
    pending.push(() => feelTable('owner'), () => feelTable('ai'));
    const next = () => {
        const job = pending.shift();
        if (!job) return;
        job();
        setTimeout(next, 30);
    };
    setTimeout(next, 1000);
}

module.exports = { search, hasSubject, isAnalyzed, sanitizeMarks, testQuestions, scoreTest, vocabulary, warmUp, feelTable, DATA_VERSION };
