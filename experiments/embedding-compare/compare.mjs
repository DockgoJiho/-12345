/**
 * 같은 검색어(한/영 쌍)를 두 모델에 넣고 상위 결과를 나란히 보여주는 비교표(out/compare.html)를 만든다.
 * 먼저 node embed.mjs clip / node embed.mjs siglip2 로 이미지 임베딩을 만들어 둬야 한다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MODELS, loadIndex, loadTextEncoder, search } from './models.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out');
const TOP_K = 8;
const OVERLAP_K = 20;

const QUERIES = [
    ['차가운데 손맛 있는', 'cold but with a handmade touch'],
    ['망가진 타이포인데 정돈된 느낌', 'broken typography that still feels orderly'],
    ['반투명 레이어가 겹친 격자', 'grid of overlapping translucent layers'],
    ['저해상도 디더링', 'low resolution dithering'],
    ['여백이 많은 미니멀한 포스터', 'minimal poster with lots of empty space'],
    ['따뜻한 필름 사진', 'warm film photograph'],
    ['거친 종이 질감의 콜라주', 'collage with rough paper texture'],
    ['기하학적인 3D 오브제', 'geometric 3D object']
];

const overlap = (a, b) => a.filter(([id]) => b.some(([id2]) => id2 === id)).length;

const results = [];
for (const name of Object.keys(MODELS)) {
    const index = loadIndex(name);
    const encode = await loadTextEncoder(name);
    for (const [ko, en] of QUERIES) {
        const koTop = search(index, await encode(ko), OVERLAP_K);
        const enTop = search(index, await encode(en), OVERLAP_K);
        results.push({ model: name, ko, en, koTop, enTop, overlap: overlap(koTop, enTop) });
    }
}

// 터미널 요약: 한국어/영어 검색 결과가 얼마나 같은 핀을 가리키는지 (상위 20개 중 겹치는 수)
console.log(`\n한/영 결과 일치도 (상위 ${OVERLAP_K}개 중 겹치는 핀 수)`);
for (const [ko] of QUERIES) {
    const row = Object.keys(MODELS).map((m) => `${m}=${results.find((r) => r.model === m && r.ko === ko).overlap}`);
    console.log(`  ${ko.padEnd(18)} ${row.join('  ')}`);
}

const img = ([id, s]) => `<figure><img src="../../../images/${id}.jpg" loading="lazy"><figcaption>${s.toFixed(3)}</figcaption></figure>`;
const cell = (top) => `<div class="row">${top.slice(0, TOP_K).map(img).join('')}</div>`;
const sections = QUERIES.map(([ko, en]) => {
    const byModel = (m) => results.find((r) => r.model === m && r.ko === ko);
    const blocks = Object.keys(MODELS).map((m) => {
        const r = byModel(m);
        return `<div class="model"><h3>${m} <small>한/영 일치 ${r.overlap}/${OVERLAP_K}</small></h3>
            <p class="lang">KO · ${ko}</p>${cell(r.koTop)}
            <p class="lang">EN · ${en}</p>${cell(r.enTop)}</div>`;
    }).join('');
    return `<section><h2>${ko} <span>/ ${en}</span></h2><div class="models">${blocks}</div></section>`;
}).join('');

fs.writeFileSync(path.join(OUT, 'compare.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>임베딩 모델 비교</title><style>
body{font-family:-apple-system,sans-serif;background:#111;color:#eee;margin:24px}
h2{font-size:18px;margin:40px 0 8px}h2 span{color:#888;font-weight:400}
h3{font-size:14px;margin:0 0 6px}h3 small{color:#8ab;font-weight:400;margin-left:8px}
.models{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.lang{font-size:12px;color:#aaa;margin:8px 0 4px}
.row{display:grid;grid-template-columns:repeat(${TOP_K},1fr);gap:4px}
figure{margin:0}img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:3px;display:block}
figcaption{font-size:10px;color:#666;text-align:right}
</style></head><body><h1>검색어별 상위 ${TOP_K}개 — 왼쪽 CLIP(영어 전용) · 오른쪽 SigLIP 2(다국어)</h1>${sections}</body></html>`);
console.log(`\n비교표: ${path.join(OUT, 'compare.html')}`);
