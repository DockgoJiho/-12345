/**
 * 로컬 핀 이미지들을 25장씩 묶어 라벨(번호)이 찍힌 컨택트시트 이미지로 만든다.
 * Claude가 시트 이미지를 직접 보고 각 칸의 대범주를 판단할 수 있도록,
 * 시트별로 "몇 번 칸 = 어떤 핀 id" 매니페스트도 함께 만든다.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PINS_PATH = path.join(__dirname, 'local_pins.json');
const OUT_DIR = process.argv[2];

if (!OUT_DIR) {
    console.error('사용법: node build_contact_sheets.mjs <출력디렉토리>');
    process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const COLS = 5;
const ROWS = 5;
const PER_SHEET = COLS * ROWS;
const CELL = 220;
const GAP = 6;
const SHEET_W = COLS * CELL + (COLS + 1) * GAP;
const SHEET_H = ROWS * CELL + (ROWS + 1) * GAP;

function labelSvg(n) {
    return Buffer.from(`
        <svg width="${CELL}" height="${CELL}">
            <rect x="0" y="0" width="34" height="22" fill="black" opacity="0.75"/>
            <text x="5" y="16" font-size="15" font-family="monospace" fill="white">${n}</text>
        </svg>
    `);
}

async function buildSheet(pins, sheetIndex) {
    const composites = [];
    for (let i = 0; i < pins.length; i++) {
        const pin = pins[i];
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const left = GAP + col * (CELL + GAP);
        const top = GAP + row * (CELL + GAP);

        const imagePath = path.join(__dirname, pin.image.replace(/^\//, ''));
        let thumbBuffer;
        try {
            thumbBuffer = await sharp(imagePath)
                .resize(CELL, CELL, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
                .png()
                .toBuffer();
        } catch (err) {
            thumbBuffer = await sharp({
                create: { width: CELL, height: CELL, channels: 3, background: { r: 200, g: 200, b: 200 } }
            }).png().toBuffer();
        }

        composites.push({ input: thumbBuffer, left, top });
        composites.push({ input: labelSvg(i + 1), left, top });
    }

    const outPath = path.join(OUT_DIR, `sheet_${String(sheetIndex).padStart(3, '0')}.png`);
    await sharp({
        create: { width: SHEET_W, height: SHEET_H, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).composite(composites).png().toFile(outPath);

    return outPath;
}

async function main() {
    const allPins = JSON.parse(fs.readFileSync(PINS_PATH, 'utf8'));
    const targets = allPins.filter((p) => p.image && p.image.startsWith('/images/'));
    console.log(`대상: ${targets.length}개, 시트당 ${PER_SHEET}개`);

    const manifest = [];
    let sheetIndex = 0;
    for (let i = 0; i < targets.length; i += PER_SHEET) {
        sheetIndex++;
        const chunk = targets.slice(i, i + PER_SHEET);
        const outPath = await buildSheet(chunk, sheetIndex);
        manifest.push({
            sheet: path.basename(outPath),
            cells: chunk.map((p, idx) => ({
                cell: idx + 1,
                id: p.id,
                title: p.title,
                description: (p.description || '').slice(0, 80)
            }))
        });
        if (sheetIndex % 10 === 0) console.log(`시트 ${sheetIndex}장 생성 완료`);
    }

    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`완료: 시트 ${sheetIndex}장, manifest.json 저장됨`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
