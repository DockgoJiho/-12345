/**
 * 키워드마다 영어 시각 묘사(expansions)의 평균 텍스트 임베딩을 모델별로 계산해 out/keyword_vectors.json에 저장한다.
 * 라벨링 서버는 텍스트 모델을 띄우지 않고 이 파일만 읽는다. keywords.mjs를 고치면 다시 실행.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MODELS, loadTextEncoder, normalize } from './models.mjs';
import { KEYWORDS } from './keywords.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const vectors = Object.fromEntries(KEYWORDS.map((k) => [k.id, {}]));

for (const name of Object.keys(MODELS)) {
    const encode = await loadTextEncoder(name);
    for (const k of KEYWORDS) {
        const vecs = await Promise.all(k.expansions.map(encode));
        const sum = new Float32Array(vecs[0].length);
        vecs.forEach((v) => v.forEach((x, i) => { sum[i] += x; }));
        vectors[k.id][name] = Array.from(normalize(sum));
    }
    console.log(`${name}: 키워드 ${KEYWORDS.length}개 완료`);
}
fs.writeFileSync(path.join(OUT, 'keyword_vectors.json'), JSON.stringify(vectors));
