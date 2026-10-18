/**
 * 사용자 핀(브라우저가 SigLIP 2로만 분석)에서도 주제(사람, 옷, 포스터 …)를 판별할 수 있도록
 * 주제 카테고리 묘사의 SigLIP 2 텍스트 벡터를 내보낸다 → out/subject_vectors.json
 * 기본 아카이브는 두 모델 평균으로 판별했으므로, SigLIP 2 하나로만 해도 같은 핀이 잡히는지 함께 확인한다.
 */
import fs from 'fs';
import { loadIndex, loadTextEncoder, normalize } from './models.mjs';
import { CATEGORIES, SUBJECTS } from './subjects.mjs';

const LOGIT_SCALE = 100;
const encode = await loadTextEncoder('siglip2');
const categories = {};
for (const [id, texts] of Object.entries(CATEGORIES)) {
    const vecs = await Promise.all(texts.map(encode));
    const sum = new Float32Array(vecs[0].length);
    vecs.forEach((v) => v.forEach((x, i) => { sum[i] += x; }));
    categories[id] = Array.from(normalize(sum));
}

// 확인: 기본 아카이브에서 SigLIP 2만으로 판별한 결과 vs 두 모델 평균(사이트가 쓰는 값)
const index = loadIndex('siglip2');
const fused = JSON.parse(fs.readFileSync('out/subject_scores.json', 'utf8'));
const catIds = Object.keys(categories);
const probsOf = (i) => {
    const logits = catIds.map((c) => { let s = 0; for (let d = 0; d < index.dim; d++) s += index.data[i * index.dim + d] * categories[c][d]; return s * LOGIT_SCALE; });
    const m = Math.max(...logits), e = logits.map((l) => Math.exp(l - m)), t = e.reduce((a, b) => a + b, 0);
    return Object.fromEntries(catIds.map((c, k) => [c, e[k] / t]));
};
const single = index.ids.map((_, i) => probsOf(i));
for (const s of SUBJECTS) {
    const a = new Set(index.ids.filter((id) => fused[s.id][id] >= s.threshold));
    const b = new Set(index.ids.filter((_, i) => s.categories.reduce((x, c) => x + single[i][c], 0) >= s.threshold));
    const both = [...a].filter((id) => b.has(id)).length;
    console.log(`${s.ko.padEnd(8)} 두 모델 ${a.size}장 · SigLIP만 ${b.size}장 · 겹침 ${both}장 (${a.size ? Math.round(both / Math.max(a.size, b.size) * 100) : 100}%)`);
}

// 한 모델로 판별하면 더 많이 잡히는 주제가 있어서, 두 모델 결과와 장수가 같아지는 기준선을 주제마다 따로 정한다
const thresholds = {};
for (const s of SUBJECTS) {
    const target = index.ids.filter((id) => fused[s.id][id] >= s.threshold).length;
    const probs = single.map((p) => s.categories.reduce((x, c) => x + p[c], 0)).sort((a, b) => b - a);
    thresholds[s.id] = target ? Math.max(s.threshold, probs[target - 1]) : s.threshold;
    const b = new Set(index.ids.filter((_, i) => s.categories.reduce((x, c) => x + single[i][c], 0) >= thresholds[s.id]));
    const a = index.ids.filter((id) => fused[s.id][id] >= s.threshold);
    console.log(`  ${s.ko.padEnd(8)} 한 모델 기준선 ${thresholds[s.id].toFixed(3)} → ${b.size}장, 두 모델과 겹침 ${a.filter((id) => b.has(id)).length}/${a.length}`);
}
const out = { logitScale: LOGIT_SCALE, categories, subjects: Object.fromEntries(SUBJECTS.map((s) => [s.id, s.categories])), thresholds };
fs.writeFileSync('out/subject_vectors.json', JSON.stringify(out));
