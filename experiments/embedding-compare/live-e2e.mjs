/**
 * 실제 사이트에서 "신규 사용자" 흐름 전체를 점검한다 - 임시 계정을 만들고, 끝나면 그 계정과 데이터를 모두 지운다.
 *   1) 임시 계정 생성 (서비스 키로 이메일 확인 없이) → 로그인
 *   2) 핀 가져오기: 기본 아카이브 핀 일부를 /api/pins/import로 (사이트의 ZIP 가져오기와 같은 경로)
 *   3) 내 핀 분석: 브라우저 분석기(pin-analyzer.js)와 같은 모델(SigLIP 2 fp16)·같은 저장 형식으로 pin_embeddings에 올림
 *   4) 감각 테스트: /api/taste/rounds로 사진을 받고, 아카이브 주인의 라벨을 "이 사람의 감각"으로 삼아 답해서 taste_marks에 저장
 *   5) 실제 사이트에서 그 사람 터널의 검색 색인·점수표를 받아, 브라우저와 같은 코드(search-core.js)로 검색하고 채점
 * 사용: node live-e2e.mjs [사이트 주소] (기본: 실제 사이트)
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { AutoProcessor, SiglipVisionModel, RawImage } from '@huggingface/transformers';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const SearchCore = require(path.join(ROOT, 'search-core.js'));

const SITE = process.argv[2] || 'https://12345-lqyq.onrender.com';
const PIN_COUNT = 400;
const WORDS = ['차가운', '매끈한', '물성 있는', '멋있는'];
const WORD_IDS = { '차가운': 'cold', '매끈한': 'smooth', '물성 있는': 'tactile', '멋있는': 'cool' };

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now().toString(36);
const email = `taste-e2e-${stamp}@example.com`;
const password = `e2e-${stamp}-${Math.random().toString(36).slice(2)}`;
const username = `e2e_${stamp}`;
const t0 = Date.now();
const step = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

let userId = null;
try {
    // 1) 임시 계정
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError) throw createError;
    userId = created.user.id;
    const { error: profileError } = await admin.from('profiles').upsert({ id: userId, username });
    if (profileError) throw profileError;
    const user = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: login, error: loginError } = await user.auth.signInWithPassword({ email, password });
    if (loginError) throw loginError;
    const auth = { Authorization: `Bearer ${login.session.access_token}` };
    step(`임시 계정 @${username}`);

    // 2) 핀 가져오기 - 아카이브 주인이 라벨을 붙인 핀을 먼저 넣어야 채점할 수 있다
    const labels = JSON.parse(fs.readFileSync(path.join(ROOT, 'taste/data/owner_labels.json'), 'utf8'));
    const labeled = new Set(Object.values(WORD_IDS).flatMap((id) => Object.keys(labels[id] || {})));
    const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'local_pins.json'), 'utf8')).filter((p) => p.image);
    const chosen = [...local.filter((p) => labeled.has(p.id)), ...local.filter((p) => !labeled.has(p.id))].slice(0, PIN_COUNT);
    const importRes = await fetch(`${SITE}/api/pins/import`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins: chosen.map((p) => ({ id: p.id, title: p.title, description: p.description, image: p.image, link: p.link, creator: p.creator })) })
    });
    const imported = await importRes.json();
    if (!importRes.ok) throw new Error(`가져오기 실패: ${JSON.stringify(imported)}`);
    const { data: myPins, error: pinsError } = await user.from('pins').select('id, source_pin_id, image').eq('owner_id', userId).range(0, 999);
    if (pinsError) throw pinsError;
    const pinIdOfSource = new Map(myPins.map((p) => [p.source_pin_id, p.id]));
    step(`핀 ${imported.inserted}개 가져옴`);

    // 3) 내 핀 분석 (브라우저와 같은 모델·정밀도·저장 형식)
    const MODEL_ID = 'onnx-community/siglip2-base-patch16-224-ONNX';
    const processor = await AutoProcessor.from_pretrained(MODEL_ID);
    const model = await SiglipVisionModel.from_pretrained(MODEL_ID, { dtype: 'fp16' });
    const encode = (v) => {
        let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
        return Buffer.from(Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round((x / n) * 127)))).buffer).toString('base64');
    };
    for (let i = 0; i < myPins.length; i += 16) {
        const batch = myPins.slice(i, i + 16);
        const images = await Promise.all(batch.map((p) => RawImage.read(path.join(ROOT, p.image))));
        let out = (await model(await processor(images))).pooler_output;
        if (out.type !== 'float32') out = out.to('float32');
        const rows = batch.map((p, j) => ({ pin_id: p.id, owner_id: userId, model: 'siglip2-base-224/fp16', vector: encode(out.data.slice(j * 768, (j + 1) * 768)) }));
        const { error } = await user.from('pin_embeddings').upsert(rows);
        if (error) throw error;
    }
    step(`핀 ${myPins.length}개 분석해서 올림`);

    // 4) 감각 테스트 - 사이트가 고른 사진에 "이 사람(아카이브 주인)의 감각"으로 답한다
    const roundsRes = await fetch(`${SITE}/api/taste/rounds`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ words: WORDS, perWord: 20 })
    });
    const rounds = await roundsRes.json();
    if (!roundsRes.ok || !rounds.rounds.length) throw new Error(`테스트 사진 받기 실패: ${JSON.stringify(rounds)}`);
    const sourceOfPin = new Map(myPins.map((p) => [p.id, p.source_pin_id]));
    const marks = rounds.rounds.flatMap((r) => r.pins.map((pinId) => ({
        owner_id: userId, word: r.word, pin_id: pinId,
        value: labels[WORD_IDS[r.word]]?.[sourceOfPin.get(pinId)] === 2 ? 2 : 0
    })));
    // 확인 라운드: 첫 라운드에서 고른 사진과 닮은 사진 12장을 받아 같은 방식으로 답한다
    const shownAll = marks.map((m) => m.pin_id);
    for (const r of rounds.rounds) {
        const picked = marks.filter((m) => m.word === r.word && m.value === 2).map((m) => m.pin_id);
        const confirmRes = await fetch(`${SITE}/api/taste/confirm`, {
            method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ word: r.word, picked, shown: shownAll, count: 12 })
        });
        const confirm = await confirmRes.json();
        if (!confirmRes.ok || !confirm.pins || !confirm.pins.length) throw new Error(`확인 라운드 실패: ${confirmRes.status} ${JSON.stringify(confirm)}`);
        confirm.pins.forEach((pinId) => {
            shownAll.push(pinId);
            marks.push({ owner_id: userId, word: r.word, pin_id: pinId, value: labels[WORD_IDS[r.word]]?.[sourceOfPin.get(pinId)] === 2 ? 2 : 0 });
        });
    }
    const { error: marksError } = await user.from('taste_marks').upsert(marks, { onConflict: 'owner_id,word,pin_id' });
    if (marksError) throw marksError;
    step(`감각 테스트: 단어 ${rounds.rounds.length}개 × (${rounds.rounds[0].pins.length}장 + 확인 12장), 고른 사진 ${marks.filter((m) => m.value === 2).length}장 / ${marks.length}장`);

    // 4-2) 결과 다듬기(다시 하기): 같은 단어로 다시 물으면, 이미 답한 핀은 나오지 않아야 한다
    const againRes = await fetch(`${SITE}/api/taste/rounds`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ words: [WORDS[0]], perWord: 20 })
    });
    const again = await againRes.json();
    const answered = new Set(marks.filter((m) => m.word === WORDS[0]).map((m) => m.pin_id));
    const repeated = (again.rounds?.[0]?.pins || []).filter((id) => answered.has(id)).length;
    step(`다시 하기('${WORDS[0]}'): 새 사진 ${again.rounds?.[0]?.pins.length || 0}장, 이미 답한 사진 ${repeated}장${repeated ? ' ← 문제' : ''}`);
    if (repeated) throw new Error('다시 하기에서 이미 답한 사진이 다시 나왔다');

    // 5) 실제 사이트에서 그 사람 터널로 검색
    const t5 = Date.now();
    const index = await (await fetch(`${SITE}/api/search/index?user=${username}`)).json();
    const feelRes = await fetch(`${SITE}/api/search/feel?basis=${index.feel.basis}&owner=${index.feel.owner}&v=${index.feel.version}`);
    const table = await feelRes.json();
    step(`검색 색인: 핀 ${index.pins.length}개, 점수표 기준 ${index.feel.basis} (${feelRes.status}, ${Date.now() - t5}ms)`);
    if (index.feel.basis !== 'user') throw new Error('그 사람 점수표가 아니라 ' + index.feel.basis + ' 기준으로 나왔다');
    // 두 번째로 받을 때(다른 방문자, 다시 들어올 때)는 서버가 만들어 둔 점수표를 쓰므로 빨라야 한다
    const t6 = Date.now();
    await (await fetch(`${SITE}/api/search/feel?basis=user&owner=${index.feel.owner}&v=${index.feel.version}&again=1`)).json();
    step(`점수표 다시 받기: ${Date.now() - t6}ms`);
    const feel = SearchCore.decodeFeelTable(table, (s) => new Uint8Array(Buffer.from(s, 'base64')));
    const parser = SearchCore.createQueryParser(index.vocab);
    const docs = index.pins.map((pin) => ({ pin, feelKey: pin.feelKey, doc: SearchCore.toSearchDoc(pin, index.dictionaries) }));
    const shown = new Set(marks.map((m) => m.pin_id));
    console.log('\n검색어      결과   상위 30장 중 (테스트에 안 나온 사진만)  맞아 / 아니야 / 라벨 없음');
    for (const word of WORDS) {
        const result = SearchCore.rankSearch(word, { parser, docs, feel });
        const top = result.pins.filter((p) => !shown.has(p.id)).slice(0, 30).map((p) => labels[WORD_IDS[word]]?.[sourceOfPin.get(p.id)]);
        console.log(`${word.padEnd(8)} ${String(result.total).padStart(4)}   ${top.filter((v) => v === 2).length} / ${top.filter((v) => v === 0).length} / ${top.filter((v) => v === undefined || v === 1).length}`);
    }
} catch (error) {
    console.error('점검 실패:', error.message || error);
    process.exitCode = 1;
} finally {
    // 정리: 임시 계정의 데이터와 계정 자체
    if (userId) {
        for (const table of ['taste_marks', 'pin_embeddings', 'pins']) await admin.from(table).delete().eq('owner_id', userId);
        await admin.from('profiles').delete().eq('id', userId);
        await admin.auth.admin.deleteUser(userId);
        step('임시 계정과 데이터 삭제');
    }
}
