/**
 * 브라우저용 경량(양자화) SigLIP 2 이미지 모델이 원래(fp32) 모델과 얼마나 같은 결과를 내는지 확인한다.
 * 1) 같은 사진의 임베딩끼리 코사인 유사도  2) 느낌 키워드 점수로 줄 세운 순위가 얼마나 같은지(스피어만)
 */
import { AutoProcessor, SiglipVisionModel, RawImage } from '@huggingface/transformers';
import fs from 'fs';
import { loadIndex, normalize } from './models.mjs';

const ID = 'onnx-community/siglip2-base-patch16-224-ONNX';
const DTYPE = process.argv[2] || 'q8';
const N = 300;
const index = loadIndex('siglip2');
const starts = JSON.parse(fs.readFileSync('out/keyword_vectors.json', 'utf8'));
const pins = index.ids.slice(0, N);

const processor = await AutoProcessor.from_pretrained(ID);
const model = await SiglipVisionModel.from_pretrained(ID, { dtype: DTYPE });
const t0 = Date.now();
const quant = [];
for (let i = 0; i < pins.length; i += 16) {
    const imgs = await Promise.all(pins.slice(i, i + 16).map((p) => RawImage.read(`../../images/${p}.jpg`)));
    const out = (await model(await processor(imgs))).pooler_output;
    for (let j = 0; j < imgs.length; j++) quant.push(normalize(out.data.slice(j * 768, (j + 1) * 768)));
}
const ms = (Date.now() - t0) / pins.length;
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const full = pins.map((_, i) => index.data.subarray(i * 768, (i + 1) * 768));
const cos = quant.map((q, i) => dot(q, full[i]));
const ranks = (v) => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = []; o.forEach(([, i], k) => { r[i] = k; }); return r; };
const spear = (a, b) => { const ra = ranks(a), rb = ranks(b), n = a.length, m = (n - 1) / 2; let s = 0, x = 0, y = 0; for (let i = 0; i < n; i++) { s += (ra[i] - m) * (rb[i] - m); x += (ra[i] - m) ** 2; y += (rb[i] - m) ** 2; } return s / Math.sqrt(x * y); };
const kw = ['cold', 'smooth', 'cool', 'pretty', 'glitch', 'cozy'];
const rs = kw.map((k) => spear(quant.map((q) => dot(q, starts[k].siglip2)), full.map((f) => dot(f, starts[k].siglip2))));
console.log(`${DTYPE}: 사진당 ${ms.toFixed(0)}ms(이 맥, Node) · 임베딩 코사인 평균 ${(cos.reduce((a, b) => a + b) / cos.length).toFixed(4)} 최저 ${Math.min(...cos).toFixed(4)} · 키워드 순위 일치 ${rs.map((r) => r.toFixed(3)).join(' ')}`);
