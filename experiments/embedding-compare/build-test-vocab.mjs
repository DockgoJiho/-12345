/**
 * 감각 테스트에서 추천할 단어 순서를 정한다 → out/test_vocab.json (키워드 id 배열, 앞일수록 먼저 추천)
 *
 * 테스트로 물어볼 가치가 큰 단어 = 사람마다 판단이 갈리는 단어. 세 가지를 합쳐서 판단한다.
 * 1. 증거: 아카이브 주인의 라벨에서 AI 기본 해석과 실제로 어긋난 단어를 맨 앞에 (어긋남이 클수록 앞)
 * 2. 성격: 기분·평가·감각을 나타내는 주관적인 말(FEEL)만 후보로 쓴다.
 *    색·구도·기법·장르·계절·장소 같은 형식적인 말은 누가 봐도 비슷해서 AI 기본 해석으로 충분하다.
 * 3. 모호함: 나머지는 두 이미지 모델(CLIP, SigLIP 2)의 해석이 많이 갈리는 순서 (subjectivity.mjs, 낮은 상관 = 모호)
 *
 * subjectivity.mjs를 먼저 실행해야 한다. 결과는 export-taste.mjs가 사이트로 내보낸다.
 */
import fs from 'fs';
import { KEYWORDS } from './keywords.mjs';
import { loadKeywordModel, scoreKeyword, YES, NO } from './keyword-rank.mjs';

// 기분·평가·감각의 말 (주관이 들어가는 단어)
const FEEL = new Set([
    'cold', 'warm', 'cozy', 'comfortable', 'pretty', 'cool', 'tactile', 'smooth', 'shiny', 'refreshing',
    'unusual_layout', 'experimental', 'eye_straining', 'chaotic', 'orderly', 'handmade',
    'dreamy', 'bright', 'dark', 'lonely', 'serene', 'tense', 'cute', 'grotesque', 'mysterious', 'epic',
    'witty', 'elegant', 'luxurious', 'kitsch', 'decadent', 'lyrical', 'intense', 'subtle',
    'raw', 'delicate', 'soft', 'heavy', 'light_weight', 'wet', 'dry', 'dynamic', 'static'
]);
const MIN_LABELS = 10; // 증거로 인정할 최소 맞아/아니야 장수 (각각)

const labels = JSON.parse(fs.readFileSync('keyword_labels.json', 'utf8'));
const ambiguity = JSON.parse(fs.readFileSync('out/subjectivity.json', 'utf8'));
const model = loadKeywordModel();

// 1. 증거: AI 기본 해석이 주인의 맞아/아니야를 얼마나 맞히는지 (0.5 = 동전 던지기, 낮을수록 어긋남)
const evidence = [];
for (const [id, marks] of Object.entries(labels)) {
    const yes = Object.keys(marks).filter((p) => marks[p] === YES), no = Object.keys(marks).filter((p) => marks[p] === NO);
    if (yes.length < MIN_LABELS || no.length < MIN_LABELS) continue;
    const scores = scoreKeyword(model, id, {});
    let win = 0;
    for (const y of yes) for (const n of no) win += scores.get(y) > scores.get(n) ? 1 : 0;
    evidence.push([id, win / (yes.length * no.length)]);
}
evidence.sort((a, b) => a[1] - b[1]);

// 2·3. 나머지 주관적인 말을 모호한 순서로
const first = evidence.map(([id]) => id);
const rest = KEYWORDS.map((k) => k.id)
    .filter((id) => FEEL.has(id) && !first.includes(id) && ambiguity[id] !== undefined)
    .sort((a, b) => ambiguity[a] - ambiguity[b]);
const order = [...first, ...rest];

fs.writeFileSync('out/test_vocab.json', JSON.stringify(order));
const ko = (id) => KEYWORDS.find((k) => k.id === id).ko;
console.log(`증거로 앞에 둔 단어: ${evidence.map(([id, a]) => `${ko(id)}(${a.toFixed(2)})`).join(', ')}`);
console.log(`추천 순서 ${order.length}개: ${order.map(ko).join(', ')}`);
