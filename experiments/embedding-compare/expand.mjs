/**
 * 추상적인 한국어 검색어를 "형식적 시각 묘사" 여러 문장으로 풀어서 검색하면 정밀도가 오르는지 비교한다.
 * 결과: out/expand.html
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { QUERIES } from './queries.mjs';
import { loadMethods } from './methods.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out');
const TOP_K = 10;

const { methods } = await loadMethods();

const results = [];
for (const q of QUERIES) {
    const rows = [];
    for (const m of methods) rows.push({ label: m.label, top: await m.run(q, TOP_K) });
    results.push({ q, rows });
}

// 여러 검색어에 반복해서 끼어드는 핀이 적을수록, 검색어의 차이를 제대로 구분하고 있다는 뜻
console.log(`\n방식별: 서로 다른 핀 수 / 전체 칸 수 (검색어 ${QUERIES.length}개 × 상위 ${TOP_K}개)`);
methods.forEach(({ label }, ci) => {
    const count = {};
    results.forEach((r) => r.rows[ci].top.forEach(([id]) => { count[id] = (count[id] || 0) + 1; }));
    const repeated = Object.values(count).filter((v) => v >= 3).length;
    console.log(`  ${label.padEnd(24)} ${Object.keys(count).length}/${QUERIES.length * TOP_K}  · 3개 이상 검색어에 반복 ${repeated}`);
});

const img = ([id, s]) => `<figure><img src="../../../images/${id}.jpg" loading="lazy"><figcaption>${s.toFixed(2)}</figcaption></figure>`;
const sections = results.map(({ q, rows }) => `<section>
    <h2>${q.ko} <span>/ ${q.en}</span></h2>
    <details><summary>영어 묘사 확장 문장 ${q.expansions.length}개</summary><ul>${q.expansions.map((e) => `<li>${e}</li>`).join('')}</ul></details>
    ${rows.map((r) => `<p class="lang">${r.label}</p><div class="row">${r.top.map(img).join('')}</div>`).join('')}
</section>`).join('');

fs.writeFileSync(path.join(OUT, 'expand.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>검색어 확장 실험</title><style>
body{font-family:-apple-system,sans-serif;background:#111;color:#eee;margin:24px;max-width:1400px}
h1{font-size:20px}h2{font-size:18px;margin:48px 0 6px}h2 span{color:#888;font-weight:400}
details{font-size:12px;color:#aaa;margin-bottom:8px}ul{margin:4px 0}
.lang{font-size:13px;color:#8ab;margin:12px 0 4px}
.row{display:grid;grid-template-columns:repeat(${TOP_K},1fr);gap:4px}
figure{margin:0}img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:3px;display:block}
figcaption{font-size:10px;color:#666;text-align:right}
</style></head><body><h1>추상 검색어 정밀도 실험 — 같은 검색어, 다섯 가지 방식 (상위 ${TOP_K}개)</h1>${sections}</body></html>`);
console.log(`\n비교표: ${path.join(OUT, 'expand.html')}`);
