/**
 * 로컬 핀 이미지 전체를 모델별로 임베딩해서 out/<model>.bin(Float32, 정규화됨) + out/<model>.ids.json 으로 저장한다.
 * 사용: node embed.mjs clip | siglip2
 */
import {
    AutoProcessor, RawImage,
    CLIPVisionModelWithProjection, SiglipVisionModel
} from '@huggingface/transformers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MODELS, normalize } from './models.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const which = process.argv[2];
const cfg = MODELS[which];
if (!cfg) throw new Error(`모델 이름: ${Object.keys(MODELS).join(' | ')}`);

const pins = JSON.parse(fs.readFileSync(path.join(ROOT, 'local_pins.json'), 'utf8'))
    .filter((p) => p.image && fs.existsSync(path.join(ROOT, p.image)));

const VisionModel = which === 'clip' ? CLIPVisionModelWithProjection : SiglipVisionModel;
const processor = await AutoProcessor.from_pretrained(cfg.id);
const model = await VisionModel.from_pretrained(cfg.id, { dtype: cfg.visionDtype });

const ids = [];
const vectors = [];
const BATCH = 16;
const started = Date.now();

for (let i = 0; i < pins.length; i += BATCH) {
    const batch = pins.slice(i, i + BATCH);
    const images = await Promise.all(batch.map((p) => RawImage.read(path.join(ROOT, p.image))));
    const inputs = await processor(images);
    const output = await model(inputs);
    const tensor = which === 'clip' ? output.image_embeds : output.pooler_output;
    const dim = tensor.dims[1];
    batch.forEach((p, j) => {
        ids.push(p.id);
        vectors.push(normalize(tensor.data.slice(j * dim, (j + 1) * dim)));
    });
    process.stdout.write(`\r${which}: ${Math.min(i + BATCH, pins.length)}/${pins.length}`);
}

const dim = vectors[0].length;
const flat = new Float32Array(vectors.length * dim);
vectors.forEach((v, i) => flat.set(v, i * dim));
fs.writeFileSync(path.join(OUT, `${which}.bin`), Buffer.from(flat.buffer));
fs.writeFileSync(path.join(OUT, `${which}.ids.json`), JSON.stringify({ dim, ids }));
console.log(`\n완료: ${ids.length}장, ${dim}차원, ${((Date.now() - started) / 1000).toFixed(1)}초`);
