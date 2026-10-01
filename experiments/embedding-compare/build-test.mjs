/**
 * 신규 가입자 "단어 감각 테스트" 문제 세트를 만든다 → out/test_set.json
 *
 * 키워드마다:
 * 1. AI 기본 해석 상위 사진들을 생김새(이미지 임베딩)로 3개 무리로 나눈다 - 같은 "차가운"이라도 파란 색감 / 금속 / 무채색처럼 갈린다
 * 2. 무리마다 어떤 특징인지 짧은 한국어 설명을 붙인다 (설명 문구 후보 중 그 무리에서 유독 두드러지는 것)
 * 3. 서로 다른 무리의 대표 사진끼리 짝지어 "둘 중 더 ○○한 쪽은?" 문제를 만든다 (무리 3개 → 문제 3개)
 *
 * 평가를 공정하게 하려고, 이미 keyword_labels.json에 라벨이 붙은 사진은 문제에서 뺀다.
 */
import fs from 'fs';
import { loadTextEncoder, normalize } from './models.mjs';
import { KEYWORDS } from './keywords.mjs';
import { loadKeywordModel, scoreKeyword } from './keyword-rank.mjs';

// 테스트에 넣을 키워드: AI 해석이 사용자 라벨과 어긋났던 것 + 원래 취향을 타는 것
export const TEST_KEYWORDS = ['cold', 'smooth', 'tactile', 'cool', 'pretty', 'comfortable', 'cozy', 'unusual_layout', 'experimental'];
const POOL = 150;      // 키워드마다 AI 상위 몇 장에서 무리를 나눌지
const CLUSTERS = 3;

// 무리 설명 후보 (한국어 설명, 영어 묘사)
const DESCRIPTORS = [
    ['파란 색감', 'blue color tones'], ['회색·무채색', 'grey achromatic colors'], ['흑백', 'black and white image'],
    ['선명한 원색', 'vivid saturated colors'], ['파스텔 색감', 'soft pastel colors'], ['따뜻한 색감', 'warm orange and red tones'],
    ['금속 재질', 'shiny metallic material'], ['유리·투명 재질', 'transparent glass material'], ['종이 질감', 'paper texture'],
    ['직물·니트 질감', 'fabric and knitted texture'], ['돌·석고 질감', 'stone or plaster texture'], ['매끈한 3D 렌더', 'smooth glossy 3d render'],
    ['실제 사진', 'a real photograph'], ['평면 그래픽', 'flat graphic design'], ['글자·타이포', 'typography and lettering'],
    ['손그림', 'hand drawn illustration'], ['패션·인물 사진', 'fashion photo of a person'], ['건축·공간', 'architecture and interior space'],
    ['자연 풍경', 'nature landscape'], ['여백이 많은 구성', 'minimal composition with empty space'], ['빽빽한 패턴', 'dense busy pattern'],
    ['격자 구성', 'grid layout'], ['부드러운 곡선', 'soft rounded curves'], ['날카로운 기하학 형태', 'sharp geometric shapes'],
    ['흐릿한 이미지', 'blurry soft focus image'], ['노이즈·글리치', 'digital noise and glitch'], ['어두운 분위기', 'dark moody image'],
    ['밝은 분위기', 'bright airy image'], ['오브제·제품', 'a product object on a plain background'], ['콜라주', 'collage of layered images']
];

const model = loadKeywordModel();
const sig = model.indexes.siglip2;
const rowOf = model.rowOf.siglip2;
const vecOf = (pin) => sig.data.subarray(rowOf.get(pin) * sig.dim, (rowOf.get(pin) + 1) * sig.dim);
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const labeled = fs.existsSync('keyword_labels.json') ? JSON.parse(fs.readFileSync('keyword_labels.json', 'utf8')) : {};

// k-평균 (코사인). 시작점에 따라 튀는 사진 한두 장이 혼자 무리가 되는 경우가 있어서,
// 시작점을 여러 번 바꿔 돌린 뒤 "무리마다 최소 MIN_SHARE 이상"인 결과 중 무리 안이 가장 촘촘한 것을 고른다
const MIN_SHARE = 0.15;
const TRIES = 30;

function kmeansOnce(pins, k, seed) {
    let state = seed;
    const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const centers = [];
    while (centers.length < k) {
        const p = pins[Math.floor(rand() * pins.length)];
        if (!centers.some((c) => c === vecOf(p))) centers.push(vecOf(p));
    }
    let assign = [];
    for (let iter = 0; iter < 20; iter++) {
        assign = pins.map((p) => centers.map((c) => dot(vecOf(p), c)).reduce((bi, s, i, arr) => (s > arr[bi] ? i : bi), 0));
        for (let c = 0; c < k; c++) {
            const members = pins.filter((_, i) => assign[i] === c);
            if (!members.length) continue;
            const sum = new Float32Array(sig.dim);
            members.forEach((p) => vecOf(p).forEach((x, d) => { sum[d] += x; }));
            centers[c] = normalize(sum);
        }
    }
    const groups = centers.map((_, c) => pins.filter((_, i) => assign[i] === c));
    const tightness = pins.reduce((a, p, i) => a + dot(vecOf(p), centers[assign[i]]), 0);
    return { centers, groups, tightness };
}

function kmeans(pins, k) {
    const runs = Array.from({ length: TRIES }, (_, t) => kmeansOnce(pins, k, t + 1));
    const balanced = runs.filter((r) => Math.min(...r.groups.map((g) => g.length)) >= pins.length * MIN_SHARE);
    return (balanced.length ? balanced : runs).sort((a, b) => b.tightness - a.tightness)[0];
}

const encode = await loadTextEncoder('siglip2');
const descVecs = await Promise.all(DESCRIPTORS.map(([, en]) => encode(en)));

const testSet = [];
const shown = new Set(); // 테스트 전체에서 한 사진은 한 번만 나오게 한다
for (const id of TEST_KEYWORDS) {
    const keyword = KEYWORDS.find((k) => k.id === id);
    const scores = scoreKeyword(model, id, {}); // 사용자 라벨 없이 AI 기본 해석
    const pool = model.uniqueIds
        .filter((pin) => labeled[id]?.[pin] === undefined)
        .sort((a, b) => scores.get(b) - scores.get(a))
        .slice(0, POOL);
    const { centers, groups } = kmeans(pool, CLUSTERS);

    // 무리 설명: 다른 무리들보다 이 무리에서 유독 높은 설명 문구 (무리끼리 같은 설명은 피한다)
    const used = new Set();
    const clusters = centers.map((c, ci) => {
        const ranked = DESCRIPTORS.map(([ko], di) => {
            const mine = dot(c, descVecs[di]);
            const others = centers.filter((_, j) => j !== ci).map((o) => dot(o, descVecs[di]));
            return [ko, mine - others.reduce((a, b) => a + b, 0) / others.length];
        }).sort((a, b) => b[1] - a[1]);
        const label = ranked.find(([ko]) => !used.has(ko))[0];
        used.add(label);
        // 대표 사진: 무리 중심에 가까운 순서
        const reps = [...groups[ci]].filter((p) => !shown.has(p)).sort((a, b) => dot(vecOf(b), c) - dot(vecOf(a), c));
        return { label, size: groups[ci].length, reps };
    });

    // 무리 쌍마다 한 문제. 아직 안 나온 대표 사진 중 무리 중심에 가장 가까운 것을 쓴다
    const pairs = [];
    for (let a = 0; a < CLUSTERS; a++) {
        for (let b = a + 1; b < CLUSTERS; b++) {
            const left = clusters[a].reps.find((p) => !shown.has(p));
            shown.add(left);
            const right = clusters[b].reps.find((p) => !shown.has(p));
            shown.add(right);
            pairs.push({ left: { pin: left, cluster: a }, right: { pin: right, cluster: b } });
        }
    }
    testSet.push({ id, ko: keyword.ko, clusters: clusters.map(({ label, size }) => ({ label, size })), pairs });
    console.log(`${keyword.ko.padEnd(8)} 무리: ${clusters.map((c) => `${c.label}(${c.size})`).join(' / ')}`);
}
fs.writeFileSync('out/test_set.json', JSON.stringify(testSet, null, 1));
