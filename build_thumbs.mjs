/**
 * 터널 카드용 작은 이미지(images/t/<핀 id>.webp)를 만든다.
 * 터널 카드는 세로 264px 캔버스에 그려지므로 원본(평균 70~80KB)을 받을 필요가 없다 - 썸네일은 약 8KB라
 * 검색 결과로 카드 이미지를 갈아끼울 때 훨씬 빨리 도착한다. 상세 페이지는 계속 원본을 쓴다.
 * 이미 만든 썸네일은 건너뛰므로, 새 이미지를 받은 뒤 다시 돌리면 새 것만 만든다.
 *
 * 사용법: node build_thumbs.mjs
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const IMAGES_DIR = path.join(process.cwd(), 'images');
const THUMBS_DIR = path.join(IMAGES_DIR, 't');
// 카드 캔버스: 세로 264px, 가로는 비율에 따라 최대 1.8배 (script.js renderPlainImageFace 참고)
const HEIGHT = 264;
const MAX_WIDTH = Math.round(HEIGHT * 1.8);

fs.mkdirSync(THUMBS_DIR, { recursive: true });
const sources = fs.readdirSync(IMAGES_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));

let made = 0, skipped = 0, before = 0, after = 0;
for (const file of sources) {
    const target = path.join(THUMBS_DIR, file.replace(/\.[^.]+$/, '.webp'));
    if (fs.existsSync(target)) { skipped++; continue; }
    await sharp(path.join(IMAGES_DIR, file))
        .resize({ height: HEIGHT, width: MAX_WIDTH, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72 })
        .toFile(target);
    before += fs.statSync(path.join(IMAGES_DIR, file)).size;
    after += fs.statSync(target).size;
    made++;
}
console.log(`썸네일 ${made}개 생성, ${skipped}개 건너뜀`);
if (made) console.log(`원본 ${(before / 1e6).toFixed(1)}MB → 썸네일 ${(after / 1e6).toFixed(1)}MB`);
