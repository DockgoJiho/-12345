/**
 * 어떤 키워드가 "주관적"인지(사람마다 판단이 갈리는지) 데이터로 추정한다.
 * 지표: 두 이미지 모델(CLIP, SigLIP 2)이 같은 키워드로 핀 1,895장을 줄 세운 순위가 얼마나 다른가 (스피어만 상관).
 *   상관이 낮다 = 같은 말을 모델끼리도 다르게 해석한다 = 뜻이 모호하다 = 테스트로 물어볼 가치가 크다.
 * 검증: 아카이브 주인이 라벨을 붙인 키워드에서 "AI 기본 해석과 주인 판단의 일치도"와 비교한다.
 * 결과: out/subjectivity.json (키워드 id → 모델 간 상관, 낮을수록 주관적)
 */
import fs from 'fs';
import { KEYWORDS } from './keywords.mjs';
import { loadKeywordModel } from './keyword-rank.mjs';

const model = loadKeywordModel();
const pins = model.uniqueIds;

function ranks(values) {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(values.length);
    order.forEach(([, i], rank) => { r[i] = rank; });
    return r;
}
function spearman(a, b) {
    const ra = ranks(a), rb = ranks(b), n = a.length;
    const mean = (n - 1) / 2;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { num += (ra[i] - mean) * (rb[i] - mean); da += (ra[i] - mean) ** 2; db += (rb[i] - mean) ** 2; }
    return num / Math.sqrt(da * db);
}
const modelScores = (name, id) => {
    const index = model.indexes[name], q = model.starts[id][name];
    return pins.map((pin) => {
        const r = model.rowOf[name].get(pin);
        let s = 0;
        for (let d = 0; d < index.dim; d++) s += index.data[r * index.dim + d] * q[d];
        return s;
    });
};

const result = Object.fromEntries(KEYWORDS.filter((k) => k.group !== 'custom').map((k) => [k.id, spearman(modelScores('clip', k.id), modelScores('siglip2', k.id))]));
fs.writeFileSync('out/subjectivity.json', JSON.stringify(result, null, 1));

const sorted = Object.entries(result).sort((a, b) => a[1] - b[1]);
const ko = (id) => KEYWORDS.find((k) => k.id === id).ko;
console.log('가장 모호한(주관적) 20개:', sorted.slice(0, 20).map(([id, r]) => `${ko(id)} ${r.toFixed(2)}`).join(', '));
console.log('가장 명확한(객관적) 15개:', sorted.slice(-15).reverse().map(([id, r]) => `${ko(id)} ${r.toFixed(2)}`).join(', '));
// 검증용: 주인 라벨로 잰 "AI 해석 - 주인 판단" 일치도 (holdout.mjs와 같은 AI 기본 해석 기준)
const known = { smooth: 0.38, tactile: 0.50, cold: 0.58, cool: 0.59 };
console.log('검증 (모델 간 상관 / AI-주인 일치도):', Object.entries(known).map(([id, a]) => `${ko(id)} ${result[id].toFixed(2)} / ${a}`).join(', '));
console.log('비교 (객관적일 것으로 보이는 단어):', ['glitch', 'monochrome', 'transparent', 'render3d'].filter((id) => result[id] !== undefined).map((id) => `${ko(id)} ${result[id].toFixed(2)}`).join(', '));
const rankOf = (id) => sorted.findIndex(([x]) => x === id) + 1;
console.log('라벨링한 키워드의 모호함 순위(85개 중):', ['smooth', 'tactile', 'cold', 'cool', 'pretty', 'comfortable', 'cozy', 'unusual_layout', 'experimental', 'glitch'].map((id) => `${ko(id)} ${rankOf(id)}위`).join(', '));
