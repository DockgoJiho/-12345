/**
 * 1회용 마이그레이션 스크립트: local_pins.json(기존 단일 사용자 데이터, 2150개)을
 * 실제 계정주의 Supabase 계정으로 옮긴다. 로컬에서 딱 한 번만 실행하고 배포 환경에는
 * 절대 올리지 않는다 (service_role 키를 쓰기 때문).
 *
 * 사전 준비:
 *   1. 실제 배포 사이트(index.html)의 회원가입 UI로 본인 계정을 먼저 만든다
 *      (다른 사용자들과 똑같은 트리거 경로로 profiles 행이 생성되게 하기 위함).
 *   2. .env에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 있는지 확인한다.
 *
 * 실행:
 *   node migrate_to_supabase.mjs <가입할 때 정한 username>
 *
 * local_pins.json과 /images/*.jpg는 그대로 디스크에 남는다 - image 컬럼 값도
 * 기존과 동일하게 '/images/<id>.jpg'로 저장되고, script.js의 기존 로컬 이미지
 * 분기 로직이 그대로 이를 처리한다.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const username = process.argv[2];
if (!username) {
    console.error('사용법: node migrate_to_supabase.mjs <username>');
    process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('.env에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다');
    process.exit(1);
}

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log(`--- "${username}" 계정 조회 ---`);
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, username')
        .eq('username', username)
        .maybeSingle();

    if (profileError) throw profileError;
    if (!profile) {
        console.error(`"${username}" 계정을 찾을 수 없습니다. 먼저 실제 사이트에서 회원가입을 완료하세요.`);
        process.exit(1);
    }
    console.log(`계정 확인됨: ${profile.username} (${profile.id})`);

    console.log('--- 이미 옮겨진 핀이 있는지 확인 ---');
    const { count: existingCount, error: countError } = await supabaseAdmin
        .from('pins')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', profile.id);
    if (countError) throw countError;
    if (existingCount > 0) {
        console.error(`이 계정에는 이미 ${existingCount}개의 핀이 있습니다. 중복 삽입을 피하기 위해 중단합니다.`);
        console.error('정말로 다시 실행하려면 이 스크립트의 이 검사를 직접 수정하세요.');
        process.exit(1);
    }

    console.log('--- local_pins.json 읽는 중 ---');
    const localPins = JSON.parse(fs.readFileSync(path.join(__dirname, 'local_pins.json'), 'utf8'));
    console.log(`${localPins.length}개 로드됨`);

    const rows = localPins.map((pin) => ({
        owner_id: profile.id,
        source_pin_id: pin.id ? String(pin.id) : null,
        title: pin.title || '제목 없음',
        description: pin.description || '',
        image: pin.image || '',
        link: pin.link || '',
        creator: pin.creator || '',
        color: pin.color || '#667eea',
        category: pin.category || null,
        color_type: pin.colorType || null,
        main_color: pin.mainColor || null,
        memo: pin.memo || '',
        custom_tags: Array.isArray(pin.customTags) ? pin.customTags : []
    })).filter((row) => !!row.image);

    console.log(`--- ${rows.length}개 배치 삽입 시작 (이미지 없는 ${localPins.length - rows.length}개는 제외) ---`);
    const BATCH_SIZE = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabaseAdmin.from('pins').insert(batch);
        if (error) throw error;
        inserted += batch.length;
        console.log(`  ${inserted} / ${rows.length}`);
    }

    console.log(`--- 완료: ${inserted}개 핀이 "${profile.username}" 계정으로 이전되었습니다 ---`);
}

main().catch((err) => {
    console.error('마이그레이션 실패:', err.message);
    process.exit(1);
});
