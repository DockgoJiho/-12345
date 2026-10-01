/**
 * 모든 핀의 주제 확률을 계산해 out/subject_scores.json에 저장한다: { 주제 id: { 핀 id: 확률 0~1 } }
 * 카테고리 후보끼리 경쟁시키는 방식(소프트맥스)이고, 두 모델(CLIP, SigLIP 2)의 확률을 평균낸다.
 * 경계선을 눈으로 정하기 위해 확률대별(0.9, 0.7, 0.5, 0.4, 0.3, 0.2 근처) 사진을 모은 out/subject_<id>_bands.png도 만든다.
 */
import sharp from 'sharp';
import fs from 'fs';
import { MODELS, loadIndex, loadTextEncoder, normalize } from './models.mjs';
import { CATEGORIES, SUBJECTS } from './subjects.mjs';

const BANDS = [0.9, 0.7, 0.5, 0.4, 0.3, 0.2];
const PER_BAND = 12;
const LOGIT_SCALE = 100; // CLIP 학습 때 쓰인 온도. 유사도 차이를 확률로 바꿀 때 얼마나 뾰족하게 할지

const catIds = Object.keys(CATEGORIES);
const probs = {}; // 핀 id → 카테고리별 확률 (모델 평균)
for (const name of Object.keys(MODELS)) {
    const index = loadIndex(name);
    const encode = await loadTextEncoder(name);
    const catVecs = [];
    for (const id of catIds) {
        const vecs = await Promise.all(CATEGORIES[id].map(encode));
        const sum = new Float32Array(vecs[0].length);
        vecs.forEach((v) => v.forEach((x, i) => { sum[i] += x; }));
        catVecs.push(normalize(sum));
    }
    index.ids.forEach((pin, i) => {
        const logits = catVecs.map((q) => {
            let s = 0;
            for (let d = 0; d < index.dim; d++) s += index.data[i * index.dim + d] * q[d];
            return s * LOGIT_SCALE;
        });
        const max = Math.max(...logits);
        const exps = logits.map((l) => Math.exp(l - max));
        const total = exps.reduce((a, b) => a + b, 0);
        probs[pin] ??= new Array(catIds.length).fill(0);
        exps.forEach((e, c) => { probs[pin][c] += e / total / Object.keys(MODELS).length; });
    });
}

const scores = {};
for (const s of SUBJECTS) {
    const cols = s.categories.map((c) => catIds.indexOf(c));
    scores[s.id] = Object.fromEntries(Object.entries(probs).map(([pin, p]) => [pin, cols.reduce((a, c) => a + p[c], 0)]));
}
fs.writeFileSync('out/subject_scores.json', JSON.stringify(scores));

for (const s of SUBJECTS) {
    const ranked = Object.entries(scores[s.id]).sort((a, b) => b[1] - a[1]);
    const comps = [];
    for (const [row, level] of BANDS.entries()) {
        const at = ranked.findIndex(([, v]) => v < level);
        const start = Math.max(0, (at === -1 ? ranked.length : at) - PER_BAND / 2);
        for (let c = 0; c < PER_BAND && start + c < ranked.length; c++) {
            comps.push({ input: await sharp(`../../images/${ranked[start + c][0]}.jpg`).resize(80, 80, { fit: 'cover' }).toBuffer(), left: c * 80, top: row * 80 });
        }
    }
    await sharp({ create: { width: PER_BAND * 80, height: BANDS.length * 80, channels: 3, background: '#000' } })
        .composite(comps).png().toFile(`out/subject_${s.id}_bands.png`);
    const count = (t) => ranked.filter(([, v]) => v >= t).length;
    console.log(`${s.ko.padEnd(8)} ${BANDS.map((b) => `${b}↑ ${count(b)}`).join(' · ')}`);
}
