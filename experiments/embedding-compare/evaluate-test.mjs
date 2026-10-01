/**
 * 단어 감각 테스트가 실제로 효과가 있는지 채점한다. 사용: node evaluate-test.mjs <이름>
 *
 * 정답지 = 그 사람이 라벨링 도구로 직접 붙인 라벨(keyword_labels.json). 테스트 문제에는 이 사진들이 빠져 있어서 공정하다.
 * 키워드마다 "맞아" 사진이 "아니야" 사진보다 점수가 높을 확률(일치도, 0.5 = 동전 던지기)을 비교한다:
 *   - AI 기본 해석 (아무것도 안 했을 때)
 *   - 테스트 결과 반영 후 (2분 테스트만 했을 때)
 */
import fs from 'fs';
import { KEYWORDS } from './keywords.mjs';
import { loadKeywordModel, scoreKeyword, YES, NO } from './keyword-rank.mjs';

const name = process.argv[2];
const file = `test_profiles/${name}.json`;
if (!name || !fs.existsSync(file)) {
    console.log(`사용: node evaluate-test.mjs <이름>  (test_profiles/ 안의 이름: ${fs.existsSync('test_profiles') ? fs.readdirSync('test_profiles').map((f) => f.replace('.json', '')).join(', ') : '없음'})`);
    process.exit(1);
}
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const truth = JSON.parse(fs.readFileSync('keyword_labels.json', 'utf8'));
const model = loadKeywordModel();

function agreement(scores, marks) {
    const yes = Object.keys(marks).filter((p) => marks[p] === YES);
    const no = Object.keys(marks).filter((p) => marks[p] === NO);
    if (yes.length < 5 || no.length < 5) return null;
    let win = 0;
    for (const y of yes) for (const n of no) win += scores.get(y) > scores.get(n) ? 1 : scores.get(y) === scores.get(n) ? 0.5 : 0;
    return win / (yes.length * no.length);
}

console.log(`\n'${name}'의 테스트 효과 (정답지: 직접 붙인 라벨 · 일치도 0.5 = 동전 던지기, 1 = 완벽)\n`);
console.log('키워드'.padEnd(10) + 'AI 기본'.padStart(8) + '테스트 후'.padStart(10) + '   변화');
const rows = [];
for (const id of Object.keys(profile.marks)) {
    const ko = KEYWORDS.find((k) => k.id === id)?.ko ?? id;
    const before = agreement(scoreKeyword(model, id, {}), truth[id] ?? {});
    if (before === null) {
        console.log(`${ko.padEnd(10)}   (정답지에 '아니야' 라벨이 부족해 채점 불가)`);
        continue;
    }
    const after = agreement(scoreKeyword(model, id, profile.marks[id]), truth[id]);
    rows.push([before, after]);
    const diff = after - before;
    console.log(`${ko.padEnd(10)}${before.toFixed(2).padStart(8)}${after.toFixed(2).padStart(10)}   ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`);
}
if (rows.length) {
    const avg = (i) => rows.reduce((a, r) => a + r[i], 0) / rows.length;
    console.log(`${'평균'.padEnd(10)}${avg(0).toFixed(2).padStart(8)}${avg(1).toFixed(2).padStart(10)}   ${avg(1) - avg(0) >= 0 ? '+' : ''}${(avg(1) - avg(0)).toFixed(2)}`);
}
