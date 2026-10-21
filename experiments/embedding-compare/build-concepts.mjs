/**
 * 사물·대상 사전(concepts.mjs)의 SigLIP 2 텍스트 벡터를 계산해 out/concept_vectors.json에 저장한다.
 * 사용자 핀은 SigLIP 2로만 분석되므로, 기본 아카이브도 같은 모델 하나로 판별해 기준을 맞춘다.
 * 검색어가 느낌 키워드·주제어와 겹치면 그쪽이 먼저 잡히므로 사전에서 빼고 알려 준다.
 * 마지막에 기본 아카이브에서 대상별로 몇 장이 잡히는지 보여 준다.
 */
import fs from 'fs';
import { loadIndex, loadTextEncoder } from './models.mjs';
import { CONCEPTS, MIN_PROBABILITY, PROMPT } from './concepts.mjs';
import { KEYWORDS } from './keywords.mjs';
import { SUBJECTS } from './subjects.mjs';

// SigLIP 2 base가 학습한 "맞을 확률" 변환 (model.safetensors의 logit_scale = ln 112.67, logit_bias)
const LOGIT_SCALE = Math.exp(4.724453449249268), LOGIT_BIAS = -16.771724700927734;

const taken = new Map();
SUBJECTS.forEach((s) => s.synonyms.forEach((w) => taken.set(w.toLowerCase(), `주제 ${s.ko}`)));
KEYWORDS.forEach((k) => k.synonyms.forEach((w) => taken.set(w.toLowerCase(), `키워드 ${k.ko}`)));
const seen = new Map();
const concepts = CONCEPTS.map((c) => ({
    ...c,
    synonyms: c.synonyms.filter((w) => {
        const key = w.toLowerCase();
        if (taken.has(key)) { console.log(`  '${w}'(${c.id}) → ${taken.get(key)}와 겹쳐서 뺌`); return false; }
        if (seen.has(key)) { console.log(`  '${w}'(${c.id}) → ${seen.get(key)}에 이미 있어서 뺌`); return false; }
        seen.set(key, c.id);
        return true;
    })
})).filter((c) => c.synonyms.length);

const encode = await loadTextEncoder('siglip2');
const vectors = {};
for (const c of concepts) vectors[c.id] = Array.from(await encode(PROMPT(c.en)));
fs.writeFileSync('out/concept_vectors.json', JSON.stringify({
    logitScale: LOGIT_SCALE, logitBias: LOGIT_BIAS, minProbability: MIN_PROBABILITY,
    concepts: concepts.map(({ id, ko, synonyms }) => ({ id, ko, synonyms })),
    vectors
}));

const index = loadIndex('siglip2');
const minLogit = Math.log(MIN_PROBABILITY / (1 - MIN_PROBABILITY));
const counts = concepts.map((c) => {
    const q = vectors[c.id];
    let n = 0;
    for (let i = 0; i < index.ids.length; i++) {
        let s = 0; for (let d = 0; d < index.dim; d++) s += index.data[i * index.dim + d] * q[d];
        if (LOGIT_SCALE * s + LOGIT_BIAS >= minLogit) n++;
    }
    return `${c.ko} ${n}`;
});
console.log(`대상 ${concepts.length}개 - 기본 아카이브(${index.ids.length}장)에서 잡히는 장수:\n${counts.join(' · ')}`);
