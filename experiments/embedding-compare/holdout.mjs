/**
 * 라벨링으로 만든 기준이 "고르지 않은 새 사진"에도 통하는지, 학습 방식별로 비교한다 (5겹 교차 검증).
 * 라벨의 80%로만 기준을 만들고, 학습에 쓰지 않은 20%의 맞아/아니야를 얼마나 맞히는지(일치도, 0.5 = 동전 던지기) 잰다.
 *
 * 방식:
 *   평균      - 지금 쓰는 방식. AI 시작점 + 맞아 평균 - 0.5 × 아니야 평균, 방향 하나
 *   갈래      - 맞아 사진을 2갈래로 나눠 갈래마다 방향을 만들고, 더 가까운 갈래의 점수를 쓴다
 *   이웃      - 내가 고른 맞아 사진 중 가장 닮은 5장과의 유사도 - 아니야 사진 중 가장 닮은 5장과의 유사도
 *   분류기    - 맞아/아니야를 가르는 경계(로지스틱 회귀)를 직접 학습
 * 갈래·이웃·분류기는 라벨이 적을 때 흔들리지 않도록 AI 시작점 점수를 절반 비중으로 섞는다.
 */
import fs from 'fs';
import { KEYWORDS } from './keywords.mjs';
import { loadKeywordModel, scoreKeyword, YES, NO } from './keyword-rank.mjs';
import { normalize } from './models.mjs';

const labels = JSON.parse(fs.readFileSync('keyword_labels.json', 'utf8'));
const model = loadKeywordModel();
const FOLDS = 5;
const PRIOR_WEIGHT = 0.5;

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const vec = (index, row) => index.data.subarray(row * index.dim, (row + 1) * index.dim);
const meanOf = (vectors, dim) => {
    const m = new Float32Array(dim);
    vectors.forEach((v) => v.forEach((x, d) => { m[d] += x / vectors.length; }));
    return m;
};
function zscore(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
    return values.map((v) => (v - mean) / sd);
}

/** 모델(CLIP, SigLIP 2)마다 점수 함수를 돌려 표준화한 뒤 평균낸다. perModel(index, start, yesVecs, noVecs) → 핀별 점수 배열 */
function fused(keywordId, train, perModel, withPrior) {
    const out = new Map();
    const names = Object.keys(model.indexes);
    for (const name of names) {
        const index = model.indexes[name];
        const start = Float32Array.from(model.starts[keywordId][name]);
        const rows = (v) => Object.entries(train).filter(([, x]) => x === v).map(([p]) => model.rowOf[name].get(p)).filter((r) => r !== undefined);
        const yesVecs = rows(YES).map((r) => vec(index, r)), noVecs = rows(NO).map((r) => vec(index, r));
        let scores = zscore(perModel(index, start, yesVecs, noVecs));
        if (withPrior) {
            const prior = zscore(index.ids.map((_, i) => dot(vec(index, i), start)));
            scores = scores.map((s, i) => s + PRIOR_WEIGHT * prior[i]);
        }
        index.ids.forEach((id, i) => out.set(id, (out.get(id) ?? 0) + scores[i] / names.length));
    }
    return out;
}

// 갈래: 맞아 사진을 2갈래로 (코사인 k-평균, 시작점은 서로 가장 먼 두 장)
function twoBranches(yesVecs, dim) {
    if (yesVecs.length < 8) return [yesVecs];
    let a = yesVecs[0];
    let b = yesVecs.reduce((far, v) => (dot(v, a) < dot(far, a) ? v : far), yesVecs[0]);
    let groups = [yesVecs, []];
    for (let it = 0; it < 10; it++) {
        groups = [[], []];
        yesVecs.forEach((v) => groups[dot(v, a) >= dot(v, b) ? 0 : 1].push(v));
        if (!groups[1].length || !groups[0].length) return [yesVecs];
        a = normalize(meanOf(groups[0], dim));
        b = normalize(meanOf(groups[1], dim));
    }
    return groups.filter((g) => g.length >= 3);
}

const METHODS = {
    평균: (id, train) => scoreKeyword(model, id, train),
    갈래: (id, train) => fused(id, train, (index, start, yes, no) => {
        const noMean = no.length ? meanOf(no, index.dim) : null;
        const dirs = twoBranches(yes, index.dim).map((g) => {
            const q = Float32Array.from(start);
            meanOf(g, index.dim).forEach((x, d) => { q[d] += x; });
            if (noMean) noMean.forEach((x, d) => { q[d] -= 0.5 * x; });
            return normalize(q);
        });
        return index.ids.map((_, i) => Math.max(...dirs.map((q) => dot(vec(index, i), q))));
    }, false),
    이웃: (id, train) => fused(id, train, (index, start, yes, no) => {
        const K = 5;
        const topMean = (x, set) => {
            if (!set.length) return 0;
            const sims = set.map((v) => dot(x, v)).sort((p, q) => q - p).slice(0, K);
            return sims.reduce((a, b) => a + b, 0) / sims.length;
        };
        return index.ids.map((_, i) => { const x = vec(index, i); return topMean(x, yes) - topMean(x, no); });
    }, true),
    분류기: (id, train) => fused(id, train, (index, start, yes, no) => {
        if (!yes.length || !no.length) return index.ids.map((_, i) => dot(vec(index, i), start));
        // L2 정규화 로지스틱 회귀, 경사하강 (특징 = 이미지 임베딩, 맞아 1 / 아니야 0, 두 클래스 같은 비중)
        const X = [...yes, ...no], y = [...yes.map(() => 1), ...no.map(() => 0)];
        const wt = [...yes.map(() => 0.5 / yes.length), ...no.map(() => 0.5 / no.length)];
        const w = new Float32Array(index.dim); let bias = 0;
        const LR = 2.0, L2 = 0.01;
        for (let it = 0; it < 300; it++) {
            const grad = new Float32Array(index.dim); let gb = 0;
            X.forEach((x, n) => {
                const p = 1 / (1 + Math.exp(-(dot(w, x) * 10 + bias)));
                const e = (p - y[n]) * wt[n];
                for (let d = 0; d < index.dim; d++) grad[d] += e * x[d] * 10;
                gb += e;
            });
            for (let d = 0; d < index.dim; d++) w[d] -= LR * (grad[d] + L2 * w[d]);
            bias -= LR * gb;
        }
        return index.ids.map((_, i) => dot(vec(index, i), w));
    }, true)
};

function agreement(scores, yes, no) {
    let win = 0;
    for (const a of yes) for (const b of no) win += scores.get(a) > scores.get(b) ? 1 : scores.get(a) === scores.get(b) ? 0.5 : 0;
    return win / (yes.length * no.length);
}

const names = Object.keys(METHODS);
console.log('키워드'.padEnd(9) + 'AI 기본'.padStart(8) + names.map((n) => n.padStart(7)).join('') + '   (처음 보는 사진 기준 일치도)');
const totals = Object.fromEntries(['AI 기본', ...names].map((n) => [n, 0]));
let count = 0;
for (const [id, marks] of Object.entries(labels)) {
    const yesAll = Object.keys(marks).filter((p) => marks[p] === YES), noAll = Object.keys(marks).filter((p) => marks[p] === NO);
    if (yesAll.length < 10 || noAll.length < 10) continue;
    const row = Object.fromEntries(['AI 기본', ...names].map((n) => [n, 0]));
    for (let f = 0; f < FOLDS; f++) {
        const testYes = yesAll.filter((_, i) => i % FOLDS === f), testNo = noAll.filter((_, i) => i % FOLDS === f);
        const train = Object.fromEntries([
            ...yesAll.filter((_, i) => i % FOLDS !== f).map((p) => [p, YES]),
            ...noAll.filter((_, i) => i % FOLDS !== f).map((p) => [p, NO])
        ]);
        row['AI 기본'] += agreement(scoreKeyword(model, id, {}), testYes, testNo) / FOLDS;
        for (const n of names) row[n] += agreement(METHODS[n](id, train), testYes, testNo) / FOLDS;
    }
    const ko = KEYWORDS.find((k) => k.id === id).ko;
    console.log(ko.padEnd(9) + row['AI 기본'].toFixed(2).padStart(8) + names.map((n) => row[n].toFixed(2).padStart(9)).join(''));
    Object.keys(totals).forEach((n) => { totals[n] += row[n]; });
    count++;
}
console.log('평균'.padEnd(9) + (totals['AI 기본'] / count).toFixed(2).padStart(8) + names.map((n) => (totals[n] / count).toFixed(2).padStart(9)).join(''));
