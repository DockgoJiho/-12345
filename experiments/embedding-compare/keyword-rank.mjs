/**
 * 키워드 점수 계산.
 * 키워드마다 "AI의 첫 해석(영어 묘사 임베딩)"에서 출발해서, 사용자가 "맞아"한 사진들 쪽으로 당기고
 * "아니야"한 사진들에서 밀어낸 방향으로 전체 핀을 다시 채점한다 (Rocchio 방식 - 라벨이 몇 장뿐이어도 동작).
 * 두 모델(CLIP, SigLIP 2)의 점수를 각각 평균 0 / 표준편차 1로 맞춘 뒤 평균낸다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MODELS, loadIndex, normalize } from './models.mjs';
import { loadCanonicalMap } from './methods.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

const POSITIVE_WEIGHT = 1.0;
const NEGATIVE_WEIGHT = 0.5;
export const YES = 2, MAYBE = 1, NO = 0;

export function loadKeywordModel() {
    const indexes = Object.fromEntries(Object.keys(MODELS).map((m) => [m, loadIndex(m)]));
    const canonicalOf = loadCanonicalMap(indexes.siglip2);
    const starts = JSON.parse(fs.readFileSync(path.join(OUT, 'keyword_vectors.json'), 'utf8'));
    // 핀 id → 각 모델 인덱스에서의 위치 (라벨 붙은 핀의 이미지 벡터를 꺼낼 때 사용)
    const rowOf = Object.fromEntries(Object.entries(indexes).map(([m, idx]) => [m, new Map(idx.ids.map((id, i) => [id, i]))]));
    const uniqueIds = indexes.siglip2.ids.filter((id) => canonicalOf.get(id) === id);
    return { indexes, canonicalOf, starts, rowOf, uniqueIds };
}

function meanOf(index, rows) {
    const mean = new Float32Array(index.dim);
    rows.forEach((r) => { for (let d = 0; d < index.dim; d++) mean[d] += index.data[r * index.dim + d] / rows.length; });
    return mean;
}

/** 키워드 하나에 대한 전체 핀 점수 (id → z점수). marks: { 핀 id: YES | MAYBE | NO } */
export function scoreKeyword(model, keywordId, marks = {}) {
    const fused = new Map();
    for (const [name, index] of Object.entries(model.indexes)) {
        const query = Float32Array.from(model.starts[keywordId][name]);
        const rowsWith = (value) => Object.entries(marks)
            .filter(([, v]) => v === value)
            .map(([id]) => model.rowOf[name].get(id))
            .filter((r) => r !== undefined);
        const pos = rowsWith(YES), neg = rowsWith(NO);
        if (pos.length) meanOf(index, pos).forEach((x, d) => { query[d] += POSITIVE_WEIGHT * x; });
        if (neg.length) meanOf(index, neg).forEach((x, d) => { query[d] -= NEGATIVE_WEIGHT * x; });
        const q = normalize(query);

        const scores = new Float32Array(index.ids.length);
        for (let i = 0; i < index.ids.length; i++) {
            let s = 0;
            for (let d = 0; d < index.dim; d++) s += index.data[i * index.dim + d] * q[d];
            scores[i] = s;
        }
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length) || 1;
        index.ids.forEach((id, i) => fused.set(id, (fused.get(id) ?? 0) + (scores[i] - mean) / sd / Object.keys(MODELS).length));
    }
    return fused;
}

/**
 * 여러 키워드 조합 검색. 모든 키워드를 만족해야 하므로(교집합) 핀마다 가장 약한 키워드 점수를 그 핀의 점수로 쓴다.
 * 예: 차가운 2.1 / 글리치 0.3 인 핀은 0.3점 - 둘 다 높아야 위로 올라온다.
 * allowed: 후보로 남길 핀 (주제 필터 - 예: 사람 사진 제외)
 */
export function searchKeywords(model, keywordIds, labels, k, allowed = () => true) {
    const perKeyword = keywordIds.map((id) => scoreKeyword(model, id, labels[id]));
    return model.uniqueIds
        .filter(allowed)
        .map((id) => {
            const each = perKeyword.map((m) => m.get(id));
            return { id, score: Math.min(...each), each };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
}
