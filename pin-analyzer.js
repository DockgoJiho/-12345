/**
 * 내 핀 이미지 분석기 - 사용자의 브라우저에서 SigLIP 2 이미지 모델로 핀마다 "생김새 벡터"를 계산해서
 * Supabase pin_embeddings에 올린다. 서버는 이 벡터와 감각 테스트 기록으로 그 사람의 느낌 검색 점수표를 만든다.
 *
 * 서버(Render 무료, 메모리 512MB)에서는 이미지 모델을 돌리기 어려워서, 각자의 브라우저가 자기 핀을 계산한다.
 * - WebGPU + fp16을 지원하면 원래 모델과 같은 결과(fp16, 처음 한 번 약 190MB 내려받기)
 * - 아니면 줄인 모델(q4f16, 약 55MB) - 원래 모델과의 일치도 약 0.96 (experiments/embedding-compare/quant-check.mjs)
 * 이미 분석한 핀은 건너뛰므로, 중간에 창을 닫아도 다음에 이어서 한다.
 * supabase-client.js(supabaseClient)가 먼저 로드되어 있어야 한다.
 */
(function () {
    const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.web.min.js';
    const MODEL_ID = 'onnx-community/siglip2-base-patch16-224-ONNX';
    const BATCH = 8;

    let running = null; // 같은 페이지에서 두 번 동시에 돌지 않게

    async function readAll(table, columns, ownerId) {
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabaseClient.from(table).select(columns).eq('owner_id', ownerId).range(from, from + 999);
            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < 1000) return rows;
        }
    }

    // 길이 1 벡터를 값×127 정수로 줄여 base64로 (핀 하나에 약 1KB, 되돌렸을 때 원래와의 일치도 약 0.998)
    function encodeVector(values) {
        let sum = 0;
        for (let i = 0; i < values.length; i++) sum += values[i] * values[i];
        const n = Math.sqrt(sum) || 1;
        let binary = '';
        for (let i = 0; i < values.length; i++) {
            const q = Math.max(-127, Math.min(127, Math.round((values[i] / n) * 127)));
            binary += String.fromCharCode(q & 0xff);
        }
        return btoa(binary);
    }

    // Pinterest 이미지는 브라우저가 직접 읽을 수 없게 막혀 있어서(CORS) 우리 서버를 거친다
    const imageUrl = (image) => (/^https?:\/\//.test(image) ? `/api/image?url=${encodeURIComponent(image.replace(/\/(736x|originals)\//, '/236x/'))}` : image);

    async function pickBackend() {
        if (navigator.gpu) {
            try {
                const adapter = await navigator.gpu.requestAdapter();
                if (adapter) return { device: 'webgpu', dtype: adapter.features.has('shader-f16') ? 'fp16' : 'q4f16' };
            } catch (e) { /* WebGPU를 못 쓰면 아래로 */ }
        }
        return { device: 'wasm', dtype: 'q4f16' };
    }

    /**
     * 내 핀 중 아직 분석 안 된 것을 분석해서 올린다.
     * onProgress({ phase: 'check' | 'model' | 'analyze' | 'done', done, total, analyzed, failed })
     * 반환: { total, analyzed, failed } - analyzed = 지금까지 분석된 내 핀 수(이번 것 포함)
     */
    function analyzeMine({ onProgress = () => {} } = {}) {
        if (running) return running;
        running = (async () => {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) throw new Error('로그인이 필요해요');

            onProgress({ phase: 'check', done: 0, total: 0 });
            const pins = (await readAll('pins', 'id, image', user.id)).filter((p) => p.image);
            let existing;
            try {
                existing = new Set((await readAll('pin_embeddings', 'pin_id', user.id)).map((r) => r.pin_id));
            } catch (err) {
                throw new Error('분석 결과를 저장할 곳이 아직 준비되지 않았어요 (DB 설정 필요)');
            }
            const todo = pins.filter((p) => !existing.has(p.id));
            const total = todo.length;
            if (!total) {
                onProgress({ phase: 'done', done: 0, total: 0, analyzed: existing.size, failed: 0 });
                return { total: pins.length, analyzed: existing.size, failed: 0 };
            }

            onProgress({ phase: 'model', done: 0, total });
            const T = await import(TRANSFORMERS_URL);
            T.env.allowLocalModels = false;
            const { device, dtype } = await pickBackend();
            const processor = await T.AutoProcessor.from_pretrained(MODEL_ID);
            let model;
            let used = { device, dtype };
            try {
                model = await T.SiglipVisionModel.from_pretrained(MODEL_ID, { device, dtype });
            } catch (err) {
                // GPU에서 못 띄우면 CPU(wasm) + 줄인 모델로
                console.warn('이미지 모델을 GPU로 띄우지 못해 CPU로 바꿉니다:', err);
                used = { device: 'wasm', dtype: 'q4f16' };
                model = await T.SiglipVisionModel.from_pretrained(MODEL_ID, used);
            }
            const modelTag = `siglip2-base-224/${used.dtype}`;

            let done = 0, failed = 0;
            for (let i = 0; i < todo.length; i += BATCH) {
                const batch = todo.slice(i, i + BATCH);
                const loaded = await Promise.all(batch.map(async (pin) => {
                    try { return { pin, image: await T.RawImage.fromURL(imageUrl(pin.image)) }; } catch (e) { return null; }
                }));
                const ok = loaded.filter(Boolean);
                failed += batch.length - ok.length;
                if (ok.length) {
                    let output = (await model(await processor(ok.map((x) => x.image)))).pooler_output;
                    if (output.type !== 'float32') output = output.to('float32');
                    const dim = output.dims[1];
                    const rows = ok.map(({ pin }, j) => ({
                        pin_id: pin.id,
                        owner_id: user.id,
                        model: modelTag,
                        vector: encodeVector(output.data.subarray(j * dim, (j + 1) * dim))
                    }));
                    const { error } = await supabaseClient.from('pin_embeddings').upsert(rows);
                    if (error) throw error;
                }
                done += batch.length;
                onProgress({ phase: 'analyze', done, total, failed, device: used.device });
            }
            const analyzed = existing.size + done - failed;
            onProgress({ phase: 'done', done, total, analyzed, failed });
            return { total: pins.length, analyzed, failed };
        })().finally(() => { running = null; });
        return running;
    }

    window.PinAnalyzer = { analyzeMine, isRunning: () => !!running };
})();
