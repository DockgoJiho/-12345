/**
 * 이미 받아둔 이미지들을 재검증하는 스크립트.
 *
 * 문제: 예전 download_images.mjs는 핀 페이지에서 "가장 큰 이미지"를 찾는
 * 방식이었는데, 핀이 삭제/비공개로 바뀌어 접근이 안 되는 경우 페이지가
 * Pinterest 탐색 피드로 대체되면서 전혀 엉뚱한(추천) 이미지를 잘못 받아온
 * 사례가 발견됨.
 *
 * 이 스크립트는 핀 페이지의 실제 본문 이미지 컨테이너
 * ([data-test-id="pin-closeup-image"])만 신뢰하고, 그게 없으면(=핀이
 * 더 이상 존재하지 않음) 그 핀을 이미지 없음으로 되돌린다.
 *
 * 사용법: Chrome 원격 디버깅 실행 후
 *   node rescan_images.mjs [처리할 개수]
 */

import fs from 'fs';
import path from 'path';

const CDP_PORT = 9222;
const IMAGES_DIR = path.join(process.cwd(), 'images');
const PINS_JSON = path.join(process.cwd(), 'local_pins.json');
const LIMIT = Number(process.argv[2] || Infinity);
const DELAY_MS = 800;

function send(ws, pending, idRef, method, params = {}) {
    const id = ++idRef.value;
    return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                reject(new Error(`timeout: ${method}`));
            }
        }, 20000);
    });
}

async function rescanOnePin(pin) {
    const newTabRes = await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(pin.link)}`, { method: 'PUT' });
    const tab = await newTabRes.json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    const pending = new Map();
    const idRef = { value: 0 };

    ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg.result);
            pending.delete(msg.id);
        }
    });

    await new Promise((resolve) => ws.addEventListener('open', resolve));

    try {
        await send(ws, pending, idRef, 'Page.enable');
        await send(ws, pending, idRef, 'Runtime.enable');

        await new Promise((r) => setTimeout(r, 4000));

        await send(ws, pending, idRef, 'Runtime.evaluate', {
            expression: `document.querySelectorAll('[role="dialog"], [data-test-id*="modal" i], [data-test-id="flashlight"]').forEach(el => el.remove());`
        });
        await new Promise((r) => setTimeout(r, 300));

        // 핀의 실제 본문 이미지만 신뢰한다 - "가장 큰 이미지" 같은 추측 금지
        const info = await send(ws, pending, idRef, 'Runtime.evaluate', {
            expression: `
                (function(){
                    const container = document.querySelector('[data-test-id="pin-closeup-image"]');
                    const img = container ? container.querySelector('img') : null;
                    if (!img) return JSON.stringify(null);
                    const r = img.getBoundingClientRect();
                    return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
                })()
            `
        });

        const rect = JSON.parse(info.result.value);
        if (!rect || rect.width < 10 || rect.height < 10) {
            return { status: 'missing' };
        }

        const shot = await send(ws, pending, idRef, 'Page.captureScreenshot', {
            format: 'jpeg',
            quality: 88,
            clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 }
        });

        const outPath = path.join(IMAGES_DIR, `${pin.id}.jpg`);
        fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
        return { status: 'ok', width: rect.width, height: rect.height };
    } finally {
        ws.close();
        await fetch(`http://localhost:${CDP_PORT}/json/close/${tab.id}`).catch(() => {});
    }
}

async function main() {
    const allPins = JSON.parse(fs.readFileSync(PINS_JSON, 'utf8'));

    // 로컬 이미지가 있던 핀들 중, 아직 재검증하지 않은 것만 대상으로 한다 (재실행/이어받기 가능)
    const targets = allPins
        .filter((p) => p.image && p.image.startsWith('/images/') && !p.rescanned)
        .slice(0, LIMIT);

    console.log(`📌 ${targets.length}개 핀을 재검증합니다...\n`);

    let invalidatedCount = 0;
    let okCount = 0;

    for (let i = 0; i < targets.length; i++) {
        const pin = targets[i];
        console.log(`[${i + 1}/${targets.length}] ${pin.description?.slice(0, 40) || pin.id}`);

        try {
            const result = await rescanOnePin(pin);
            if (result.status === 'ok') {
                pin.rescanned = true;
                okCount++;
                console.log(`  ✓ 정상 확인/갱신 (${result.width.toFixed(0)}x${result.height.toFixed(0)})`);
            } else {
                // 핀이 더 이상 존재하지 않음 - 잘못 받아둔 이미지를 지우고 목록에서 빠지게 한다
                const badPath = path.join(IMAGES_DIR, `${pin.id}.jpg`);
                if (fs.existsSync(badPath)) fs.unlinkSync(badPath);
                pin.image = '';
                pin.rescanned = true;
                invalidatedCount++;
                console.log(`  ⚠ 핀을 찾을 수 없어 이미지 제거함`);
            }
        } catch (err) {
            console.warn(`  ✗ 오류: ${err.message}`);
        }

        if (i % 20 === 0) {
            fs.writeFileSync(PINS_JSON, JSON.stringify(allPins, null, 2), 'utf8');
        }
        await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    fs.writeFileSync(PINS_JSON, JSON.stringify(allPins, null, 2), 'utf8');
    console.log(`\n✅ 재검증 완료: 정상 ${okCount}개, 무효화(이미지 제거) ${invalidatedCount}개`);
}

main();
