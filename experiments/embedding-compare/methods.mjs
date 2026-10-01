/**
 * 비교할 검색 방식들. expand.mjs(눈으로 보는 비교표), pool.mjs(라벨링 후보), evaluate.mjs(채점)가 같은 정의를 쓴다.
 * 모든 방식은 거의 같은 이미지(중복 핀)를 하나로 묶은 뒤 상위 k개를 돌려준다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadIndex, loadTextEncoder, normalize, search } from './models.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const DUPLICATE_THRESHOLD = 0.97;

/**
 * 거의 같은 이미지끼리 묶어서 각 핀 id → 대표 핀 id 맵을 만든다 (SigLIP 2 이미지 임베딩 코사인 유사도 기준).
 * 계산이 몇 초 걸려서 out/duplicates.json에 저장해 두고 재사용한다.
 */
export function loadCanonicalMap(index) {
    const cache = path.join(OUT, 'duplicates.json');
    if (fs.existsSync(cache)) return new Map(Object.entries(JSON.parse(fs.readFileSync(cache, 'utf8'))));

    const { ids, dim, data } = index;
    const canonical = ids.map((id) => id);
    for (let i = 0; i < ids.length; i++) {
        if (canonical[i] !== ids[i]) continue;
        for (let j = i + 1; j < ids.length; j++) {
            if (canonical[j] !== ids[j]) continue;
            let s = 0;
            for (let d = 0; d < dim; d++) s += data[i * dim + d] * data[j * dim + d];
            if (s > DUPLICATE_THRESHOLD) canonical[j] = ids[i];
        }
    }
    const map = Object.fromEntries(ids.map((id, i) => [id, canonical[i]]));
    fs.writeFileSync(cache, JSON.stringify(map));
    return new Map(Object.entries(map));
}

// 각 모델의 전체 점수를 평균 0 / 표준편차 1로 맞춘다 (모델끼리 점수 크기가 달라서 바로 더할 수 없다)
function zscores(ranked) {
    const mean = ranked.reduce((a, [, s]) => a + s, 0) / ranked.length;
    const sd = Math.sqrt(ranked.reduce((a, [, s]) => a + (s - mean) ** 2, 0) / ranked.length) || 1;
    return new Map(ranked.map(([id, s]) => [id, (s - mean) / sd]));
}

async function meanEmbedding(encode, texts) {
    const vecs = await Promise.all(texts.map(encode));
    const sum = new Float32Array(vecs[0].length);
    vecs.forEach((v) => v.forEach((x, i) => { sum[i] += x; }));
    return normalize(sum);
}

export async function loadMethods() {
    const clip = { index: loadIndex('clip'), encode: await loadTextEncoder('clip') };
    const sig = { index: loadIndex('siglip2'), encode: await loadTextEncoder('siglip2') };
    const canonicalOf = loadCanonicalMap(sig.index);

    // 전체 순위에서 중복 핀은 대표 핀 하나만 남기고 상위 k개를 자른다
    const topUnique = (ranked, k) => ranked.filter(([id]) => canonicalOf.get(id) === id).slice(0, k);
    const rankAll = (model, q) => search(model.index, q, model.index.ids.length);

    return {
        canonicalOf,
        methods: [
            { key: 'sig_ko', label: '① SigLIP 2 · 한국어 그대로',
                run: async (q, k) => topUnique(rankAll(sig, await sig.encode(q.ko)), k) },
            { key: 'sig_en', label: '② SigLIP 2 · 영어 직역',
                run: async (q, k) => topUnique(rankAll(sig, await sig.encode(q.en)), k) },
            { key: 'sig_exp', label: '③ SigLIP 2 · 영어 묘사 확장',
                run: async (q, k) => topUnique(rankAll(sig, await meanEmbedding(sig.encode, q.expansions)), k) },
            { key: 'clip_exp', label: '④ CLIP · 영어 묘사 확장',
                run: async (q, k) => topUnique(rankAll(clip, await meanEmbedding(clip.encode, q.expansions)), k) },
            { key: 'fused_exp', label: '⑤ 두 모델 합산 · 영어 묘사 확장',
                run: async (q, k) => {
                    const a = zscores(rankAll(sig, await meanEmbedding(sig.encode, q.expansions)));
                    const b = zscores(rankAll(clip, await meanEmbedding(clip.encode, q.expansions)));
                    const fused = [...a].map(([id, s]) => [id, (s + (b.get(id) ?? 0)) / 2]).sort((x, y) => y[1] - x[1]);
                    return topUnique(fused, k);
                } }
        ]
    };
}
