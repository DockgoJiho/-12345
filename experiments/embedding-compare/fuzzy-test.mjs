/**
 * 사전에 없는 표현을 다국어 문장 임베딩(multilingual-e5-small)으로 가장 가까운 키워드에 연결할 수 있는지 시험한다.
 * 키워드 이름 + 동의어 각각을 임베딩해 두고, 새 표현과 가장 비슷한 동의어의 키워드를 고른다.
 */
import { pipeline } from '@huggingface/transformers';
import { KEYWORDS } from './keywords.mjs';

// e5 계열은 입력 앞에 "query: "를 붙이도록 학습됐다 (모델 카드)
const embed = await pipeline('feature-extraction', process.env.E5 || 'Xenova/multilingual-e5-small', { dtype: 'q8' });
const vec = async (t) => (await embed(process.env.CTX ? `query: 이미지의 분위기가 ${t} 느낌` : `query: ${t}`, { pooling: 'mean', normalize: true })).data;

const lexicon = [];
for (const k of KEYWORDS) {
    for (const s of new Set([k.ko, ...k.synonyms])) lexicon.push({ id: k.id, ko: k.ko, text: s, v: await vec(s) });
}

function nearest(v) {
    const best = new Map();
    for (const e of lexicon) {
        let s = 0;
        for (let i = 0; i < v.length; i++) s += v[i] * e.v[i];
        if (!best.has(e.ko) || best.get(e.ko).s < s) best.set(e.ko, { s, via: e.text });
    }
    return [...best].sort((a, b) => b[1].s - a[1].s).slice(0, 3);
}

const TESTS = ['쫀득한', '칙칙한', '화려한', '심심한', '정갈한', '어수선한', '아기자기한', '묘한', '뽀송뽀송한', '반질반질한', '휑한', '쨍쨍한', '음침한', '청순한', '포스터', '사진', '고양이', '타이포그래피'];
for (const t of TESTS) {
    const top = nearest(await vec(t));
    console.log(t.padEnd(8), top.map(([ko, { s, via }]) => `${ko}(${s.toFixed(3)}, ${via})`).join('  '));
}
