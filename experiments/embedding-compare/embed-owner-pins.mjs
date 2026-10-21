/**
 * 기본 아카이브 주인의 핀 중 이미지 분석이 안 된 핀(Pinterest 동기화로 들어온 핀 등)을 분석해 pin_embeddings에 올린다.
 * 사용자 브라우저 분석기(pin-analyzer.js)와 같은 모델·저장 형식이고, 여기서는 원래 정밀도(fp32)로 계산한다.
 * - 처음 아카이브(taste/data의 핀)는 이미 계산된 SigLIP 2 벡터를 그대로 올린다 (브라우저 분석기가 다시 계산하지 않도록)
 * - 나머지는 Pinterest 이미지(236x)를 받아 계산한다. 이미 올린 핀은 건너뛰므로 중간에 멈춰도 다시 실행하면 이어서 한다
 * 사용: node embed-owner-pins.mjs [아카이브 주인 username] (기본: .env의 DEFAULT_ARCHIVE_USERNAME)
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { AutoProcessor, SiglipVisionModel, RawImage } from '@huggingface/transformers';
import { loadIndex } from './models.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');

const MODEL_ID = 'onnx-community/siglip2-base-patch16-224-ONNX';
const MODEL_TAG = 'siglip2-base-224/fp32';
const BATCH = 16;
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const username = process.argv[2] || process.env.DEFAULT_ARCHIVE_USERNAME;

async function readAll(table, columns, column, value) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from(table).select(columns).eq(column, value).range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) return rows;
    }
}

const encode = (v) => {
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    return Buffer.from(Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round((x / n) * 127)))).buffer).toString('base64');
};
async function upload(rows) {
    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from('pin_embeddings').upsert(rows.slice(i, i + 500));
        if (error) throw error;
    }
}

const { data: profile, error: profileError } = await admin.from('profiles').select('id').eq('username', username).single();
if (profileError) throw profileError;
const ownerId = profile.id;
const pins = (await readAll('pins', 'id, source_pin_id, image', 'owner_id', ownerId)).filter((p) => p.image);
const done = new Set((await readAll('pin_embeddings', 'pin_id', 'owner_id', ownerId)).map((r) => r.pin_id));
const todo = pins.filter((p) => !done.has(p.id));
console.log(`@${username}: 핀 ${pins.length}개, 이미 분석 ${done.size}개, 남은 ${todo.length}개`);

// 1) 처음 아카이브 핀: 계산해 둔 벡터를 그대로
const index = loadIndex('siglip2');
const rowOf = new Map(index.ids.map((id, i) => [id, i]));
const archived = todo.filter((p) => rowOf.has(p.source_pin_id));
await upload(archived.map((p) => {
    const r = rowOf.get(p.source_pin_id);
    return { pin_id: p.id, owner_id: ownerId, model: MODEL_TAG, vector: encode(index.data.subarray(r * index.dim, (r + 1) * index.dim)) };
}));
console.log(`계산해 둔 벡터로 ${archived.length}개 올림`);

// 2) 나머지: 이미지를 받아 계산
const rest = todo.filter((p) => !rowOf.has(p.source_pin_id));
const processor = await AutoProcessor.from_pretrained(MODEL_ID);
const model = await SiglipVisionModel.from_pretrained(MODEL_ID, { dtype: 'fp32' });
const small = (url) => url.replace(/\/(736x|1200x|originals)\//, '/236x/');
const load = async (p) => {
    if (!/^https?:\/\//.test(p.image)) return RawImage.read(path.join(ROOT, p.image));
    for (const url of [small(p.image), p.image]) {
        try { return await RawImage.fromURL(url); } catch (e) { /* 작은 크기가 없으면 원래 주소로 */ }
    }
    return null;
};
let failed = 0;
const t0 = Date.now();
for (let i = 0; i < rest.length; i += BATCH) {
    const batch = rest.slice(i, i + BATCH);
    const loaded = (await Promise.all(batch.map(async (p) => ({ p, image: await load(p).catch(() => null) })))).filter((x) => x.image);
    failed += batch.length - loaded.length;
    if (loaded.length) {
        const out = (await model(await processor(loaded.map((x) => x.image)))).pooler_output;
        await upload(loaded.map(({ p }, j) => ({ pin_id: p.id, owner_id: ownerId, model: MODEL_TAG, vector: encode(out.data.slice(j * 768, (j + 1) * 768)) })));
    }
    const n = Math.min(i + BATCH, rest.length);
    if (n % 320 < BATCH || n === rest.length) console.log(`${n}/${rest.length} (실패 ${failed}) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log(`끝: ${rest.length - failed}개 분석, 실패 ${failed}개`);
