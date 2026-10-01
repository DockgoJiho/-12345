import {
    AutoTokenizer, CLIPTextModelWithProjection, SiglipTextModel
} from '@huggingface/transformers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

// 비교 대상 모델. 둘 다 transformers.js용 ONNX 가중치가 Hugging Face에 올라와 있는 것만 골랐다.
export const MODELS = {
    // 영어 전용 기준선
    clip: { id: 'Xenova/clip-vit-base-patch32', visionDtype: 'fp32', textDtype: 'fp32' },
    // 다국어 (SigLIP 2 논문: "Multilingual Vision-Language Encoders")
    siglip2: { id: 'onnx-community/siglip2-base-patch16-224-ONNX', visionDtype: 'fp32', textDtype: 'fp32' }
};

export function normalize(v) {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    const n = Math.sqrt(sum) || 1;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
    return out;
}

export function loadIndex(name) {
    const { dim, ids } = JSON.parse(fs.readFileSync(path.join(OUT, `${name}.ids.json`), 'utf8'));
    const buf = fs.readFileSync(path.join(OUT, `${name}.bin`));
    return { dim, ids, data: new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4) };
}

export async function loadTextEncoder(name) {
    const cfg = MODELS[name];
    const tokenizer = await AutoTokenizer.from_pretrained(cfg.id);
    if (name === 'clip') {
        const model = await CLIPTextModelWithProjection.from_pretrained(cfg.id, { dtype: cfg.textDtype });
        return async (text) => {
            const inputs = tokenizer([text], { padding: true, truncation: true });
            return normalize((await model(inputs)).text_embeds.data);
        };
    }
    // SigLIP 2는 max_length=64 패딩 + 소문자 텍스트로 학습됐다 (Hugging Face SigLIP2 문서)
    const model = await SiglipTextModel.from_pretrained(cfg.id, { dtype: cfg.textDtype });
    return async (text) => {
        const inputs = tokenizer([text.toLowerCase()], { padding: 'max_length', truncation: true, max_length: 64 });
        return normalize((await model(inputs)).pooler_output.data);
    };
}

export function search(index, q, k) {
    const scores = [];
    for (let i = 0; i < index.ids.length; i++) {
        let s = 0;
        const off = i * index.dim;
        for (let d = 0; d < index.dim; d++) s += index.data[off + d] * q[d];
        scores.push([index.ids[i], s]);
    }
    return scores.sort((a, b) => b[1] - a[1]).slice(0, k);
}

