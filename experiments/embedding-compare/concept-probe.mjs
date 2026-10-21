/**
 * 사물·대상 단어(얼굴, 고양이 …)를 SigLIP 2의 "맞을 확률"로 판별할 수 있는지 눈으로 확인한다.
 * 확률 = sigmoid(112.67 × 유사도 − 16.77) - SigLIP 2 base가 학습한 값 (model.safetensors의 logit_scale, logit_bias)
 * 확률대별(0.5, 0.2, 0.1, 0.05, 0.02, 0.01 근처) 사진을 out/concept_<이름>.png로 모은다.
 * 사용: node concept-probe.mjs "a photo of a face" "a cat" ...
 */
import sharp from 'sharp';
import { loadIndex, loadTextEncoder } from './models.mjs';

const SCALE = Math.exp(4.724453449249268), BIAS = -16.771724700927734;
const BANDS = [0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
const PER_BAND = 12;
const index = loadIndex('siglip2');
const encode = await loadTextEncoder('siglip2');
for (const text of process.argv.slice(2)) {
    const q = await encode(text);
    const ranked = index.ids.map((id, i) => {
        let s = 0; for (let d = 0; d < index.dim; d++) s += index.data[i * index.dim + d] * q[d];
        return [id, 1 / (1 + Math.exp(-(SCALE * s + BIAS)))];
    }).sort((a, b) => b[1] - a[1]);
    const comps = [];
    for (const [row, level] of BANDS.entries()) {
        const at = ranked.findIndex(([, v]) => v < level);
        const start = Math.max(0, (at === -1 ? ranked.length : at) - PER_BAND / 2);
        for (let c = 0; c < PER_BAND && start + c < ranked.length; c++) {
            comps.push({ input: await sharp(`../../images/${ranked[start + c][0]}.jpg`).resize(80, 80, { fit: 'cover' }).toBuffer(), left: c * 80, top: row * 80 });
        }
    }
    const name = text.replace(/[^a-z]+/gi, '_');
    await sharp({ create: { width: PER_BAND * 80, height: BANDS.length * 80, channels: 3, background: '#000' } }).composite(comps).png().toFile(`out/concept_${name}.png`);
    console.log(`${text.padEnd(32)} ${BANDS.map((b) => `${b}↑ ${ranked.filter(([, v]) => v >= b).length}`).join(' · ')}`);
}
