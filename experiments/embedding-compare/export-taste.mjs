/**
 * 실험 결과를 메인 사이트용 데이터로 내보낸다 → <프로젝트 루트>/taste/data/
 * 사이트 서버(taste/engine.js)는 무거운 AI 모델 없이 이 파일들만 읽어서 검색한다.
 * 키워드·주제·라벨·테스트 문제를 고친 뒤에는 다시 실행하고 커밋하면 된다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { KEYWORDS } from './keywords.mjs';
import { SUBJECTS } from './subjects.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const DEST = path.join(HERE, '..', '..', 'taste', 'data');
fs.mkdirSync(DEST, { recursive: true });

const copy = (name, as = name) => fs.copyFileSync(path.join(OUT, name), path.join(DEST, as));
const write = (name, value) => fs.writeFileSync(path.join(DEST, name), JSON.stringify(value));

// 이미지 임베딩 (모델별) + 중복 핀 묶음 + 주제 확률 + 테스트 문제
for (const model of ['clip', 'siglip2']) {
    copy(`${model}.bin`);
    copy(`${model}.ids.json`);
}
copy('duplicates.json');
copy('subject_scores.json');
copy('test_set.json');

// 키워드 사전과 시작점 (사전에 있는 키워드만)
const vectors = JSON.parse(fs.readFileSync(path.join(OUT, 'keyword_vectors.json'), 'utf8'));
const missing = KEYWORDS.filter((k) => !vectors[k.id]).map((k) => k.id);
if (missing.length) throw new Error(`시작점이 없는 키워드: ${missing.join(', ')} - build-keywords.mjs를 먼저 실행`);
write('keywords.json', KEYWORDS.map(({ id, ko, group, synonyms }) => ({ id, ko, group: group ?? 'mine', synonyms })));
write('keyword_vectors.json', Object.fromEntries(KEYWORDS.map((k) => [k.id, vectors[k.id]])));
write('subjects.json', SUBJECTS.map(({ id, ko, threshold, synonyms }) => ({ id, ko, threshold, synonyms })));

// 아카이브 주인(나)의 라벨 - 사이트에서는 읽기 전용 기준으로 쓴다
fs.copyFileSync(path.join(HERE, 'keyword_labels.json'), path.join(DEST, 'owner_labels.json'));

const size = fs.readdirSync(DEST).reduce((a, f) => a + fs.statSync(path.join(DEST, f)).size, 0);
console.log(`내보냄: ${fs.readdirSync(DEST).length}개 파일, ${(size / 1e6).toFixed(1)}MB → ${DEST}`);
