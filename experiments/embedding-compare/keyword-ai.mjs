/**
 * 사전에 없는 표현을 Claude에게 해석시킨다.
 * - 기존 키워드와 같은 느낌이면 → 그 키워드에 연결 (다음부터는 사전에서 바로 찾도록 비슷한 말로 등록)
 * - 어느 키워드와도 겹치지 않는 새 느낌이면 → 새 키워드 제안 (이름, 비슷한 말, 영어 시각 묘사)
 * - 느낌이 아닌 말(사물, 주제, 군더더기)이면 → 무시
 * 한 번 물어본 표현은 term_cache.json에 저장해서 같은 말로 두 번 비용을 쓰지 않는다.
 * ANTHROPIC_API_KEY(프로젝트 .env)가 없으면 아무것도 하지 않고 { kind: 'unavailable' }을 돌려준다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { KEYWORDS } from './keywords.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(HERE, 'term_cache.json');
const MODEL = 'claude-opus-5';

// 키는 메인 프로젝트 .env에서 읽는다 (실험 폴더에 키 파일을 따로 두지 않도록)
function readApiKey() {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    const envFile = path.join(HERE, '..', '..', '.env');
    if (!fs.existsSync(envFile)) return null;
    const line = fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='));
    return line ? line.slice('ANTHROPIC_API_KEY='.length).trim() || null : null;
}

const apiKey = readApiKey();
const client = apiKey ? new Anthropic({ apiKey }) : null;
export const aiEnabled = !!client;

const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
const saveCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));

const Result = z.object({
    terms: z.array(z.object({
        term: z.string().describe('입력에 나온 표현 그대로'),
        stem: z.string().describe('표현의 어간 - 사전 등록용 (예: 칙칙하고 → 칙칙, 쫀득한 → 쫀득, 아기자기한 → 아기자기)'),
        kind: z.enum(['mapped', 'new', 'ignored']),
        keyword_ids: z.array(z.string()).describe('mapped일 때 가장 가까운 기존 키워드 id 1~2개, 아니면 빈 배열'),
        new_keyword: z.object({
            ko: z.string().describe('새 키워드 이름 (한국어, 형용사형)'),
            synonyms: z.array(z.string()).describe('같은 뜻의 한국어 표현 3~6개 (어간 위주, 예: 쫀득, 쫄깃)'),
            expansions: z.array(z.string()).describe('이 느낌을 이미지로 묘사하는 짧은 영어 문장 4개 - 질감, 형태, 색, 빛, 구성 같은 눈에 보이는 요소로')
        }).nullable().describe('kind가 new일 때만, 아니면 null'),
        reason: z.string().describe('판단 이유를 한국어로 한 문장')
    }))
});

function systemPrompt() {
    const list = KEYWORDS.map((k) => `${k.id} | ${k.ko} | ${k.synonyms.join(', ')}`).join('\n');
    return `너는 디자이너용 이미지 레퍼런스 검색 도구의 "느낌 키워드" 해석기다.
사용자는 사진을 찾을 때 주관적인 느낌을 말로 쓴다. 사전에서 못 찾은 표현이 들어오면, 각 표현을 아래 셋 중 하나로 판단한다.

1. mapped: 기존 키워드 중 이미지로 봤을 때 같은 느낌을 가리키는 것이 있으면 그 id를 고른다 (1~2개). 글자 모양이 아니라 뜻으로 판단한다.
   예: "정갈한" → orderly, "칙칙한" → muted (+ dark), "아기자기한" → cute
2. new: 기존 키워드 어느 것으로도 그 느낌이 제대로 표현되지 않을 때만 새 키워드를 만든다. 비슷한 키워드가 있으면 새로 만들지 말고 mapped로 한다.
3. ignored: 느낌이 아닌 말 - 사물·주제(고양이, 포스터, 건물), 군더더기, 오타처럼 해석할 수 없는 말.

검색 대상은 그래픽 디자인, 사진, 일러스트, 타이포그래피, 공간, 패션 등 시각 레퍼런스 이미지다.

기존 키워드 (id | 이름 | 비슷한 말):
${list}`;
}

/**
 * 사전에 없는 표현들을 해석한다. 캐시에 있는 표현은 API를 부르지 않는다.
 * 반환: [{ term, kind: 'mapped'|'new'|'ignored'|'unavailable'|'error', keywordIds, newKeyword, reason }]
 */
export async function interpretTerms(terms) {
    const fresh = terms.filter((t) => !cache[t]);
    if (fresh.length && !client) {
        return terms.map((t) => cache[t] ?? { term: t, kind: 'unavailable', keywordIds: [], reason: 'AI 연결이 꺼져 있어요 (API 키 없음)' });
    }
    if (fresh.length) {
        try {
            const response = await client.beta.messages.parse({
                model: MODEL,
                max_tokens: 4000,
                // 거절(refusal)되면 서버가 알아서 다른 모델로 다시 시도한다
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default',
                // 단순 분류라 낮은 effort로 충분하다 (속도와 비용 절약)
                output_config: { effort: 'low', format: betaZodOutputFormat(Result) },
                // 키워드 목록(시스템 프롬프트)은 매번 같으니 캐시해서 두 번째부터 싸게 읽는다
                system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
                messages: [{ role: 'user', content: `사전에 없는 표현: ${fresh.map((t) => `"${t}"`).join(', ')}` }]
            });
            if (response.stop_reason === 'refusal' || !response.parsed_output) {
                return terms.map((t) => cache[t] ?? { term: t, kind: 'error', keywordIds: [], reason: 'AI가 해석하지 못했어요' });
            }
            const validIds = new Set(KEYWORDS.map((k) => k.id));
            for (const r of response.parsed_output.terms) {
                cache[r.term] = {
                    term: r.term,
                    stem: r.stem,
                    kind: r.kind,
                    keywordIds: r.keyword_ids.filter((id) => validIds.has(id)),
                    newKeyword: r.kind === 'new' ? r.new_keyword : null,
                    reason: r.reason
                };
            }
            saveCache();
        } catch (error) {
            const reason = error instanceof Anthropic.AuthenticationError ? 'API 키가 올바르지 않아요'
                : error instanceof Anthropic.RateLimitError ? '요청이 많아요 - 잠시 후 다시 시도해 주세요'
                    : error instanceof Anthropic.APIError ? `AI 오류 (${error.status})` : 'AI 연결 실패';
            console.error('키워드 해석 실패:', error.message);
            return terms.map((t) => cache[t] ?? { term: t, kind: 'error', keywordIds: [], reason });
        }
    }
    return terms.map((t) => cache[t] ?? { term: t, kind: 'ignored', keywordIds: [], reason: 'AI 응답에 없던 표현' });
}
