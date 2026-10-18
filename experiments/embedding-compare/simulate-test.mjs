/**
 * 신규 사용자 감각 테스트 시뮬레이션 - "12장 테스트 한 번으로 그 사람 감각을 얼마나 맞히게 되나"를 잰다.
 *
 * 가상의 신규 사용자 = 아카이브 주인. 주인이 라벨을 붙인 사진(맞아/아니야)을 그 사람의 실제 감각으로 본다.
 * 사이트와 같은 코드(taste/engine.js)로, 사이트처럼 SigLIP 2 하나의 벡터만 쓴다.
 * 키워드마다 REPEAT번:
 *   1) 라벨 붙은 사진 중에서 12장을 골라 보여준다 (무작위 / 사이트의 고르는 방식)
 *   2) 라벨대로 답한다 (맞아 = 고름, 아니야 = 안 고름)
 *   3) 그 12개 답만으로 학습한 점수가, 테스트에 나오지 않은 나머지 라벨 사진의 맞아/아니야를 얼마나 맞히는지 잰다
 * 비교: AI 기본 해석(테스트 안 함) / 무작위 12장 / 고른 12장 / (참고) 라벨 전부로 학습
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const engine = require(path.join(ROOT, 'taste/engine.js'));
const DATA = path.join(ROOT, 'taste/data');
const REPEAT = 40, PER_WORD = 12;

const { dim, ids } = JSON.parse(fs.readFileSync(path.join(DATA, 'siglip2.ids.json'), 'utf8'));
const buf = fs.readFileSync(path.join(DATA, 'siglip2.bin'));
const data = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
const vectors = ids.map((_, i) => data.subarray(i * dim, (i + 1) * dim));
const rowOf = new Map(ids.map((id, i) => [id, i]));
const starts = JSON.parse(fs.readFileSync(path.join(DATA, 'keyword_vectors.json'), 'utf8'));
const keywords = JSON.parse(fs.readFileSync(path.join(DATA, 'keywords.json'), 'utf8'));
const labels = JSON.parse(fs.readFileSync(path.join(DATA, 'owner_labels.json'), 'utf8'));

function agreement(scores, yes, no) {
    if (!yes.length || !no.length) return null;
    let win = 0;
    for (const y of yes) for (const n of no) win += scores[rowOf.get(y)] > scores[rowOf.get(n)] ? 1 : 0;
    return win / (yes.length * no.length);
}
const learn = (id, yes, no) => engine.scoreVectors(vectors, starts[id].siglip2, yes.map((p) => vectors[rowOf.get(p)]), no.map((p) => vectors[rowOf.get(p)]));
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// 비교할 사진 고르기 방식 (pool: 이 키워드에 라벨이 있는 사진들)
const STRATEGIES = {
    '무작위12': (pool) => shuffle(pool.map((p) => p.key)).slice(0, 12),
    'AI순12': (pool, ko) => engine.pickTestPins(pool, ko, 12),
    '다양12': (pool) => engine.pickTestPins(pool, '__사전에없는말__', 12),
    '무작위20': (pool) => shuffle(pool.map((p) => p.key)).slice(0, 20),
    '다양20': (pool) => engine.pickTestPins(pool, '__사전에없는말__', 20)
};
const names = Object.keys(STRATEGIES);
console.log('키워드'.padEnd(9) + 'AI 기본'.padStart(8) + names.map((n) => n.padStart(8)).join('') + '라벨전부'.padStart(9));
const rows = [];
for (const [id, marks] of Object.entries(labels)) {
    const yesAll = Object.keys(marks).filter((p) => marks[p] === 2 && rowOf.has(p));
    const noAll = Object.keys(marks).filter((p) => marks[p] === 0 && rowOf.has(p));
    if (yesAll.length < 10 || noAll.length < 10) continue;
    const ko = keywords.find((k) => k.id === id).ko;
    const isYes = new Set(yesAll);
    const pool = [...yesAll, ...noAll].map((p) => ({ key: p, vector: vectors[rowOf.get(p)] }));
    const evalShown = (shownList) => {
        const shown = new Set(shownList);
        const testYes = yesAll.filter((p) => !shown.has(p)), testNo = noAll.filter((p) => !shown.has(p));
        return agreement(learn(id, shownList.filter((p) => isYes.has(p)), shownList.filter((p) => !isYes.has(p))), testYes, testNo);
    };
    const row = { ko, base: agreement(engine.scoreVectors(vectors, starts[id].siglip2, [], []), yesAll, noAll) };
    names.forEach((n) => { const r = []; for (let i = 0; i < REPEAT; i++) r.push(evalShown(STRATEGIES[n](pool, ko))); row[n] = mean(r); });
    const full = [];
    for (let f = 0; f < 5; f++) {
        const tr = (arr) => arr.filter((_, i) => i % 5 !== f), te = (arr) => arr.filter((_, i) => i % 5 === f);
        full.push(agreement(learn(id, tr(yesAll), tr(noAll)), te(yesAll), te(noAll)));
    }
    row.full = mean(full);
    rows.push(row);
    console.log(ko.padEnd(9) + row.base.toFixed(2).padStart(8) + names.map((n) => row[n].toFixed(2).padStart(10)).join('') + row.full.toFixed(2).padStart(9));
}
const avg = (k) => mean(rows.map((r) => r[k])).toFixed(2);
console.log('평균'.padEnd(9) + avg('base').padStart(8) + names.map((n) => avg(n).padStart(10)).join('') + avg('full').padStart(9));
console.log(`(일치도: 테스트에 안 나온 사진의 맞아/아니야를 맞힐 확률, 0.5 = 동전 던지기 · ${REPEAT}번 평균)`);
