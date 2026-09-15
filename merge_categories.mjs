/**
 * 8개의 서브에이전트가 컨택트시트를 보고 분류한 결과(results_1~8.json)를
 * local_pins.json의 각 핀에 category 필드로 병합한다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PINS_PATH = path.join(__dirname, 'local_pins.json');
const SHEETS_DIR = process.argv[2];

if (!SHEETS_DIR) {
    console.error('사용법: node merge_categories.mjs <contact_sheets 디렉토리>');
    process.exit(1);
}

const VALID_KEYS = new Set([
    'photography', 'graphic_design', 'illustration', 'typography', '3d',
    'fashion', 'architecture', 'interior', 'textile_craft', 'abstract', 'fine_art', 'nature'
]);

function main() {
    const pins = JSON.parse(fs.readFileSync(PINS_PATH, 'utf8'));
    const pinById = new Map(pins.map((p) => [String(p.id), p]));

    let totalApplied = 0;
    let totalInvalid = 0;
    let totalMissing = 0;

    for (let i = 1; i <= 8; i++) {
        const resultPath = path.join(SHEETS_DIR, `results_${i}.json`);
        if (!fs.existsSync(resultPath)) {
            console.warn(`없음: results_${i}.json`);
            continue;
        }
        const results = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        results.forEach(({ id, category }) => {
            if (!VALID_KEYS.has(category)) {
                totalInvalid++;
                console.warn(`잘못된 category "${category}" (id=${id})`);
                return;
            }
            const pin = pinById.get(String(id));
            if (!pin) {
                totalMissing++;
                console.warn(`매칭되는 핀 없음: id=${id}`);
                return;
            }
            pin.category = category;
            totalApplied++;
        });
        console.log(`results_${i}.json: ${results.length}개 처리`);
    }

    fs.writeFileSync(PINS_PATH, JSON.stringify(pins, null, 2), 'utf8');
    console.log(`\n적용: ${totalApplied}, 잘못된 카테고리: ${totalInvalid}, 매칭 실패: ${totalMissing}`);

    const targets = pins.filter((p) => p.image && p.image.startsWith('/images/'));
    const uncategorized = targets.filter((p) => !p.category);
    console.log(`전체 유효 핀: ${targets.length}, 카테고리 없음: ${uncategorized.length}`);
}

main();
