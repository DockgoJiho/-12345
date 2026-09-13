/**
 * Pinterest 핀 페이지를 실제로 방문해서 이미지를 캡처, 로컬에 저장하는 스크립트
 * (i.pinimg.com 직접 요청은 CDN에서 차단되지만, 핀 페이지 방문은 차단되지 않는다)
 *
 * 사용법:
 *   1. Chrome을 원격 디버깅 모드로 띄운다:
 *      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *        --headless=new --remote-debugging-port=9222 --no-sandbox \
 *        --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader &
 *   2. node download_images.mjs
 */

import fs from 'fs';
import path from 'path';

const CDP_PORT = 9222;
const IMAGES_DIR = path.join(process.cwd(), 'images');
const PINS_JSON = path.join(process.cwd(), 'local_pins.json');
const LIMIT = Number(process.argv[2] || 50);
const DELAY_MS = 800;

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR);

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

async function downloadOnePin(pin) {
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

        // 이미지 로드 대기
        await new Promise((r) => setTimeout(r, 4000));

        // 모달/오버레이 제거
        await send(ws, pending, idRef, 'Runtime.evaluate', {
            expression: `document.querySelectorAll('[role="dialog"], [data-test-id*="modal" i], [data-test-id="flashlight"]').forEach(el => el.remove());`
        });
        await new Promise((r) => setTimeout(r, 300));

        const info = await send(ws, pending, idRef, 'Runtime.evaluate', {
            expression: `
                (function(){
                    const imgs = Array.from(document.querySelectorAll('img'));
                    let best = null, bestArea = 0;
                    for (const img of imgs) {
                        const r = img.getBoundingClientRect();
                        const area = r.width * r.height;
                        if (area > bestArea && r.width > 100 && img.src.includes('pinimg.com')) {
                            bestArea = area; best = img;
                        }
                    }
                    if (!best) return JSON.stringify(null);
                    const r = best.getBoundingClientRect();
                    return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
                })()
            `
        });

        const rect = JSON.parse(info.result.value);
        if (!rect || rect.width < 10 || rect.height < 10) {
            console.warn(`  ✗ [${pin.id}] 이미지를 찾지 못함`);
            return false;
        }

        const shot = await send(ws, pending, idRef, 'Page.captureScreenshot', {
            format: 'jpeg',
            quality: 88,
            clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 }
        });

        const outPath = path.join(IMAGES_DIR, `${pin.id}.jpg`);
        fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
        console.log(`  ✓ [${pin.id}] 저장 완료 (${rect.width.toFixed(0)}x${rect.height.toFixed(0)})`);
        return true;
    } finally {
        ws.close();
        await fetch(`http://localhost:${CDP_PORT}/json/close/${tab.id}`).catch(() => {});
    }
}

async function main() {
    const allPins = JSON.parse(fs.readFileSync(PINS_JSON, 'utf8'));
    const targets = allPins.slice(0, LIMIT);
    console.log(`📌 ${targets.length}개 핀의 이미지를 다운로드합니다... (전체 ${allPins.length}개 중)\n`);

    let success = 0;
    let skipped = 0;
    for (let i = 0; i < targets.length; i++) {
        const pin = targets[i];
        const outPath = path.join(IMAGES_DIR, `${pin.id}.jpg`);

        // 이미 받아둔 파일은 다시 방문하지 않고 건너뛴다 (재실행/이어받기용)
        if (fs.existsSync(outPath)) {
            pin.image = `/images/${pin.id}.jpg`;
            success++;
            skipped++;
            if (skipped % 50 === 0) console.log(`[${i + 1}/${targets.length}] (이미 완료된 항목 ${skipped}개 건너뜀...)`);
            continue;
        }

        console.log(`[${i + 1}/${targets.length}] ${pin.description?.slice(0, 40) || pin.id}`);
        try {
            const ok = await downloadOnePin(pin);
            if (ok) {
                pin.image = `/images/${pin.id}.jpg`;
                success++;
            }
        } catch (err) {
            console.warn(`  ✗ [${pin.id}] 실패: ${err.message}`);
        }

        // 중간에 중단되어도 진행 상황이 남도록 주기적으로 저장
        if (i % 20 === 0) {
            fs.writeFileSync(PINS_JSON, JSON.stringify(allPins, null, 2), 'utf8');
        }
        await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    // 전체 목록은 그대로 두고, 다운로드한 항목만 image 경로를 로컬 파일로 교체
    fs.writeFileSync(PINS_JSON, JSON.stringify(allPins, null, 2), 'utf8');
    console.log(`\n✅ 완료: ${success}/${targets.length}개 성공, local_pins.json 갱신됨 (전체 ${allPins.length}개 유지)`);
}

main();
