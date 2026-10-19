/**
 * 감각 테스트 시뮬레이션 (실제 상황에 가깝게): 테스트 사진을 "아카이브 전체"에서 고른다.
 * simulate-test.mjs는 라벨 붙은 사진(맞아·아니야가 반반쯤) 안에서만 골라서, 실제보다 "맞아"가 많이 나왔다.
 * 실제 아카이브에서는 한 단어에 해당하는 사진이 적어서, 서로 다른 사진만 고르면 "맞아"가 거의 없을 수 있다.
 *
 * 가상의 사람 = 아카이브 주인. 라벨 없는 사진의 답은 "주인 라벨 전부로 학습한 기준"으로 정한다
 * (라벨 붙은 사진과 가장 잘 맞는 경계로 맞아/아니야를 나눈다). 채점은 테스트에 안 나온 라벨 사진으로.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const engine = require(path.join(ROOT, 'taste/engine.js'));
const DATA = path.join(ROOT, 'taste/data');
const REPEAT = 30, N = 20;

const { dim, ids } = JSON.parse(fs.readFileSync(path.join(DATA, 'siglip2.ids.json'), 'utf8'));
const buf = fs.readFileSync(path.join(DATA, 'siglip2.bin'));
const data = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
const vectors = ids.map((_, i) => data.subarray(i * dim, (i + 1) * dim));
const rowOf = new Map(ids.map((id, i) => [id, i]));
const starts = JSON.parse(fs.readFileSync(path.join(DATA, 'keyword_vectors.json'), 'utf8'));
const keywords = JSON.parse(fs.readFileSync(path.join(DATA, 'keywords.json'), 'utf8'));
const labels = JSON.parse(fs.readFileSync(path.join(DATA, 'owner_labels.json'), 'utf8'));
const pins = ids.map((id, i) => ({ key: id, vector: vectors[i] }));
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function agreement(scores, yes, no) {
    let win = 0;
    for (const y of yes) for (const n of no) win += scores[rowOf.get(y)] > scores[rowOf.get(n)] ? 1 : 0;
    return win / (yes.length * no.length);
}
const learn = (id, yes, no) => engine.scoreVectors(vectors, starts[id].siglip2, yes.map((p) => vectors[rowOf.get(p)]), no.map((p) => vectors[rowOf.get(p)]));

// 답을 보고 더 묻는 방식: 고른 사진이 MIN_PICKS 미만이면 12장을 더 보여준다
// (0장이면 AI가 그 단어 같다고 본 사진 중 안 보여준 것, 1장 이상이면 고른 사진과 닮은 사진)
const MIN_PICKS = 3, MORE = 12;
function followUp(id, shown, says) {
    const picked = shown.filter(says);
    if (picked.length >= MIN_PICKS) return shown;
    const seen = new Set(shown);
    const target = picked.length
        ? (x) => Math.max(...picked.map((p) => dot(x, vectors[rowOf.get(p)])))
        : (x) => dot(x, starts[id].siglip2);
    const more = ids.filter((p) => !seen.has(p)).sort((a, b) => target(vectors[rowOf.get(b)]) - target(vectors[rowOf.get(a)])).slice(0, MORE);
    return [...shown, ...more];
}
const mixed = (id, ko) => {
    const top = shuffle([...ids].sort((a, b) => dot(vectors[rowOf.get(b)], starts[id].siglip2) - dot(vectors[rowOf.get(a)], starts[id].siglip2)).slice(0, 40)).slice(0, N / 2);
    return [...top, ...engine.pickTestPins(pins, ko, N / 2, new Set(top))];
};

const STRATEGIES = {
    '섞기20': mixed,
    '섞기20+부족시12': (id, ko, says) => followUp(id, mixed(id, ko), says),
    '섞기20+항상12': (id, ko, says) => {
        const shown = mixed(id, ko);
        const picked = shown.filter(says);
        const seen = new Set(shown);
        const target = picked.length ? (x) => Math.max(...picked.map((p) => dot(x, vectors[rowOf.get(p)]))) : (x) => dot(x, starts[id].siglip2);
        return [...shown, ...ids.filter((p) => !seen.has(p)).sort((a, b) => target(vectors[rowOf.get(b)]) - target(vectors[rowOf.get(a)])).slice(0, MORE)];
    },
    '섞기40': (id, ko) => {
        const top = shuffle([...ids].sort((a, b) => dot(vectors[rowOf.get(b)], starts[id].siglip2) - dot(vectors[rowOf.get(a)], starts[id].siglip2)).slice(0, 80)).slice(0, N);
        return [...top, ...engine.pickTestPins(pins, ko, N, new Set(top))];
    }
};
const names = Object.keys(STRATEGIES);
console.log('키워드'.padEnd(8) + '맞아비율'.padStart(8) + 'AI기본'.padStart(8) + names.map((n) => n.padStart(Math.max(10, n.length + 2))).join(''));
const totals = Object.fromEntries(['base', ...names].map((n) => [n, []]));
for (const [id, marks] of Object.entries(labels)) {
    const yesAll = Object.keys(marks).filter((p) => marks[p] === 2 && rowOf.has(p));
    const noAll = Object.keys(marks).filter((p) => marks[p] === 0 && rowOf.has(p));
    if (yesAll.length < 10 || noAll.length < 10) continue;
    const ko = keywords.find((k) => k.id === id).ko;
    // 가상의 사람: 라벨 전부로 학습한 기준에서, 라벨 사진을 가장 잘 나누는 경계 이상이면 "맞아"
    const oracle = learn(id, yesAll, noAll);
    const labeledScores = [...yesAll.map((p) => [oracle[rowOf.get(p)], 1]), ...noAll.map((p) => [oracle[rowOf.get(p)], 0])].sort((a, b) => a[0] - b[0]);
    let best = { acc: -1, t: 0 };
    labeledScores.forEach(([t]) => {
        const acc = labeledScores.filter(([s, y]) => (s >= t ? 1 : 0) === y).length;
        if (acc > best.acc) best = { acc, t };
    });
    const says = (p) => (marks[p] === 2 ? true : marks[p] === 0 ? false : oracle[rowOf.get(p)] >= best.t);
    const yesRate = ids.filter(says).length / ids.length;
    const row = [ko.padEnd(8), `${(yesRate * 100).toFixed(0)}%`.padStart(8), agreement(learn(id, [], []), yesAll, noAll).toFixed(2).padStart(8)];
    totals.base.push(agreement(learn(id, [], []), yesAll, noAll));
    names.forEach((n) => {
        const r = [];
        for (let i = 0; i < REPEAT; i++) {
            const shown = STRATEGIES[n](id, ko, says);
            const set = new Set(shown);
            r.push(agreement(learn(id, shown.filter(says), shown.filter((p) => !says(p))), yesAll.filter((p) => !set.has(p)), noAll.filter((p) => !set.has(p))));
        }
        totals[n].push(mean(r));
        row.push(mean(r).toFixed(2).padStart(Math.max(10, n.length + 2)));
    });
    console.log(row.join(''));
}
console.log('평균'.padEnd(8) + ''.padStart(8) + mean(totals.base).toFixed(2).padStart(8) + names.map((n) => mean(totals[n]).toFixed(2).padStart(Math.max(10, n.length + 2))).join(''));
