/**
 * 모든 로컬 핀 이미지를 픽셀 단위로 분석해서
 * - colorType: 'monochrome' | 'polychrome'
 * - mainColor: 대표 색상 hex + 색상명(한/영)
 * 을 계산하고 local_pins.json에 저장한다.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PINS_PATH = path.join(__dirname, 'local_pins.json');

const NAMED_COLORS = [
    { key: 'red', en: 'Red', ko: '빨강', rgb: [210, 50, 45] },
    { key: 'orange', en: 'Orange', ko: '주황', rgb: [235, 140, 40] },
    { key: 'yellow', en: 'Yellow', ko: '노랑', rgb: [230, 210, 50] },
    { key: 'green', en: 'Green', ko: '초록', rgb: [60, 150, 80] },
    { key: 'teal', en: 'Teal', ko: '청록', rgb: [30, 140, 140] },
    { key: 'blue', en: 'Blue', ko: '파랑', rgb: [50, 100, 200] },
    { key: 'navy', en: 'Navy', ko: '남색', rgb: [25, 40, 95] },
    { key: 'purple', en: 'Purple', ko: '보라', rgb: [130, 60, 160] },
    { key: 'pink', en: 'Pink', ko: '분홍', rgb: [230, 140, 180] },
    { key: 'brown', en: 'Brown', ko: '갈색', rgb: [120, 80, 55] },
    { key: 'beige', en: 'Beige', ko: '베이지', rgb: [215, 195, 160] },
    { key: 'white', en: 'White', ko: '흰색', rgb: [245, 245, 245] },
    { key: 'gray', en: 'Gray', ko: '회색', rgb: [140, 140, 140] },
    { key: 'black', en: 'Black', ko: '검정', rgb: [25, 25, 25] }
];

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    const d = max - min;
    if (d !== 0) {
        s = d / (1 - Math.abs(2 * l - 1));
        switch (max) {
            case r: h = ((g - b) / d) % 6; break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h *= 60;
        if (h < 0) h += 360;
    }
    return [h, s, l];
}

function nearestNamedColor(r, g, b) {
    let best = NAMED_COLORS[0];
    let bestDist = Infinity;
    for (const c of NAMED_COLORS) {
        const d = (r - c.rgb[0]) ** 2 + (g - c.rgb[1]) ** 2 + (b - c.rgb[2]) ** 2;
        if (d < bestDist) { bestDist = d; best = c; }
    }
    return best;
}

async function analyzeImage(imagePath) {
    const SIZE = 48;
    const { data, info } = await sharp(imagePath)
        .resize(SIZE, SIZE, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const totalPixels = info.width * info.height;
    const hueBins = new Array(12).fill(0);
    let colorfulCount = 0;

    // 대표색 계산용: RGB를 5bit(32단계)로 양자화해서 가장 많이 등장하는 버킷을 찾는다
    const buckets = new Map();

    for (let i = 0; i < data.length; i += info.channels) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const [h, s, l] = rgbToHsl(r, g, b);

        // 채도가 낮거나 너무 어둡거나/밝은 픽셀은 "무채색"으로 보고 색상 다양성 판단에서 제외
        if (s > 0.15 && l > 0.08 && l < 0.95) {
            colorfulCount++;
            hueBins[Math.floor(h / 30) % 12]++;
        }

        const key = `${r >> 3}_${g >> 3}_${b >> 3}`;
        const entry = buckets.get(key);
        if (entry) {
            entry.count++;
            entry.r += r; entry.g += g; entry.b += b;
        } else {
            buckets.set(key, { count: 1, r, g, b });
        }
    }

    // colorType 판단: 채도 있는 픽셀 비율이 낮으면 무채색(monochrome),
    // 채도 있는 픽셀이 있어도 한두 색상군(인접 색상대)에 몰려있으면 단색조(monochrome)로 본다
    const colorfulRatio = colorfulCount / totalPixels;
    let colorType = 'polychrome';
    if (colorfulRatio < 0.08) {
        colorType = 'monochrome';
    } else {
        const sorted = [...hueBins].sort((a, b2) => b2 - a);
        const top2 = sorted[0] + sorted[1];
        if (top2 / colorfulCount > 0.8) {
            colorType = 'monochrome';
        }
    }

    // 대표색: 가장 큰 버킷의 평균 RGB
    let topBucket = null;
    for (const entry of buckets.values()) {
        if (!topBucket || entry.count > topBucket.count) topBucket = entry;
    }
    const mr = Math.round(topBucket.r / topBucket.count);
    const mg = Math.round(topBucket.g / topBucket.count);
    const mb = Math.round(topBucket.b / topBucket.count);
    const hex = '#' + [mr, mg, mb].map((v) => v.toString(16).padStart(2, '0')).join('');
    const named = nearestNamedColor(mr, mg, mb);

    return {
        colorType,
        mainColor: { hex, key: named.key, en: named.en, ko: named.ko }
    };
}

async function main() {
    const pins = JSON.parse(fs.readFileSync(PINS_PATH, 'utf8'));
    const targets = pins.filter((p) => p.image && p.image.startsWith('/images/'));
    console.log(`분석 대상: ${targets.length}개`);

    let done = 0;
    let failed = 0;
    const BATCH = 20;

    for (let i = 0; i < targets.length; i += BATCH) {
        const batch = targets.slice(i, i + BATCH);
        await Promise.all(batch.map(async (pin) => {
            try {
                const imagePath = path.join(__dirname, pin.image.replace(/^\//, ''));
                const result = await analyzeImage(imagePath);
                pin.colorType = result.colorType;
                pin.mainColor = result.mainColor;
            } catch (err) {
                failed++;
                console.warn(`실패: ${pin.id} (${err.message})`);
            }
        }));
        done += batch.length;
        if (done % 200 === 0 || done === targets.length) {
            console.log(`진행: ${done}/${targets.length}`);
            fs.writeFileSync(PINS_PATH, JSON.stringify(pins, null, 2), 'utf8');
        }
    }

    fs.writeFileSync(PINS_PATH, JSON.stringify(pins, null, 2), 'utf8');
    console.log(`완료. 실패: ${failed}개`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
