/**
 * 검색 핵심 로직 - 서버(server.js, taste/engine.js)와 브라우저(script.js)가 같은 파일을 쓴다.
 *
 * 브라우저는 터널에 들어올 때 핀 목록과 "핀 × 느낌 키워드 점수표"를 한 번 받아 두고, 그 뒤로는
 * 글자를 칠 때마다 서버에 묻지 않고 여기서 바로 계산한다 (무료 서버는 새 검색어마다 몇 초씩 걸린다).
 * 검색어 해석과 순위 규칙이 서버와 브라우저에서 갈라지지 않도록 둘 다 이 파일만 쓴다.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SearchCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const WORD_START = '(^|[^\\p{L}\\p{N}])';
    // 주제어 뒤에 붙을 수 있는 조사 ("옷이", "사람들을", "포스터인데") - "옷장"처럼 다른 낱말이 되는 건 제외
    const PARTICLE = '(?:들)?(?:이랑|인데|이고|이나|에서|으로|처럼|이|가|을|를|은|는|의|도|만|랑|과|와|에|로)?';
    // "사람 없는", "옷 빼고", "음식 사진 말고"
    const NEGATION = '(?:\\s*(?:사진|이미지|그림))?\\s*(?:이?\\s*없는|없이|빼고|제외|말고|아닌)';
    // 키워드가 아닌 연결어/군더더기 - 모르는 말로 취급하지 않는다
    const FILLER = new Set(['느낌', '느낌의', '같은', '같이', '하고', '이고', '인데', '그리고', '그런', '이런', '좀', '약간', '조금', '많이', '아주', '너무', '엄청', '되게', '사진', '이미지', '레퍼런스', '스타일', '분위기', '분위기의', '많은', '있는', '없는', '위주', '위주로', '들어간', '나오는', '느낌으로']);

    /**
     * 느낌 키워드·주제 목록으로 검색어 해석기를 만든다. 정규식은 여기서 한 번만 만들어 둔다
     * (타이핑할 때마다 수백 개를 새로 만들면 느려진다).
     * vocab: { keywords: [{ id, synonyms }], subjects: [{ id, synonyms }] }
     */
    function createQueryParser(vocab) {
        const subjectRules = vocab.subjects
            .flatMap((s) => s.synonyms.map((syn) => [syn.toLowerCase(), s.id]))
            .sort((a, b) => b[0].length - a[0].length)
            .map(([syn, id]) => {
                const word = `${WORD_START}${escape(syn)}`;
                return {
                    id,
                    negated: new RegExp(`${word}${PARTICLE}${NEGATION}`, 'u'),
                    negatedAll: new RegExp(`${word}${PARTICLE}${NEGATION}`, 'gu'),
                    plain: new RegExp(`${word}${PARTICLE}(?=$|[^\\p{L}\\p{N}])`, 'u'),
                    plainAll: new RegExp(`${word}${PARTICLE}(?=$|[^\\p{L}\\p{N}])`, 'gu')
                };
            });

        // 같은 표현이 키워드 여러 개에 연결될 수 있다
        const idsOf = new Map();
        vocab.keywords.forEach((k) => k.synonyms.forEach((s) => {
            const key = s.toLowerCase();
            idsOf.set(key, [...(idsOf.get(key) || []), k.id]);
        }));
        const keywordRules = [...idsOf]
            .sort((a, b) => b[0].length - a[0].length)
            .map(([syn, ids]) => ({
                ids,
                // 단어 첫머리에서 시작하는 경우만 인정한다 ("감정적인"의 '정적'은 무시)
                at: new RegExp(`${WORD_START}${escape(syn)}[\\p{L}\\p{N}]*`, 'u'),
                atAll: new RegExp(`${WORD_START}${escape(syn)}[\\p{L}\\p{N}]*`, 'gu')
            }));

        /** "옷" → include, "사람 없는" / "옷 빼고" → exclude. 찾은 주제어는 지워서 rest로 돌려준다 */
        function parseSubjects(text) {
            let rest = text.toLowerCase();
            const include = [], exclude = [];
            for (const rule of subjectRules) {
                if (rule.negated.test(rest)) {
                    if (!exclude.includes(rule.id)) exclude.push(rule.id);
                    rest = rest.replace(rule.negatedAll, '$1 ');
                } else if (rule.plain.test(rest)) {
                    if (!include.includes(rule.id)) include.push(rule.id);
                    rest = rest.replace(rule.plainAll, '$1 ');
                }
            }
            return { include, exclude, rest };
        }

        function parseKeywords(text) {
            let rest = text.toLowerCase();
            const ids = [];
            for (const rule of keywordRules) {
                if (rule.at.test(rest)) {
                    rule.ids.forEach((id) => { if (!ids.includes(id)) ids.push(id); });
                    rest = rest.replace(rule.atAll, '$1 ');
                }
            }
            const unknown = rest.split(/[\s,./·+&]+/).filter((t) => t.length >= 2 && !FILLER.has(t));
            return { ids, unknown };
        }

        return { parseSubjects, parseKeywords };
    }

    /**
     * 글자 검색용으로 핀 하나를 미리 정리해 둔다 (핀은 서버 API 응답 모양, camelCase).
     * dictionaries: { categories: { key: [용어...] }, colorTypes: { key: [...] }, mainColors: { key: [...] } }
     * 대범주/모노크롬-폴리크롬/메인색은 한글·영어 동의어를 전부 섞어 넣어서 언어가 달라도 매칭되게 한다.
     */
    function toSearchDoc(pin, dictionaries) {
        const title = (pin.title || '').toLowerCase();
        const description = (pin.description || '').toLowerCase();
        const memo = (pin.memo || '').toLowerCase();
        const tags = Array.isArray(pin.customTags) ? pin.customTags.map((t) => String(t).toLowerCase()) : [];
        const categoryTerms = pin.category ? (dictionaries.categories[pin.category] || []) : [];
        const colorTypeTerms = pin.colorType ? (dictionaries.colorTypes[pin.colorType] || []) : [];
        const mainColor = pin.mainColor;
        const mainColorTerms = mainColor
            ? (dictionaries.mainColors[mainColor.key] || [mainColor.key, mainColor.en, mainColor.ko].filter(Boolean))
            : [];
        const haystack = [title, description, memo, ...tags, ...categoryTerms, ...colorTypeTerms, ...mainColorTerms]
            .join(' ').toLowerCase();
        return {
            title, description, memo, tags, haystack,
            categoryTerms: categoryTerms.map((t) => t.toLowerCase()),
            colorTypeTerms,
            mainColorTerms: mainColorTerms.map((t) => t.toLowerCase())
        };
    }

    /**
     * 글자 검색 점수. 모든 키워드를 포함하면 점수를, 하나라도 빠지면 null을 돌려준다
     * (태그를 하나씩 추가할수록 특정성이 강해지도록 AND).
     * 필드별 가중치: 직접 붙인 키워드 완전일치 > 대범주/색상 > 제목 > 메모 > 설명
     */
    function scoreTextMatch(doc, keywords) {
        if (!keywords.every((kw) => doc.haystack.includes(kw))) return null;
        let score = 0;
        keywords.forEach((kw) => {
            if (doc.tags.includes(kw)) score += 12;
            else if (doc.tags.some((t) => t.includes(kw))) score += 8;
            if (doc.categoryTerms.includes(kw)) score += 10;
            if (doc.colorTypeTerms.includes(kw) || doc.mainColorTerms.includes(kw)) score += 6;
            if (doc.title.includes(kw)) score += 5;
            if (doc.memo.includes(kw)) score += 3;
            if (doc.description.includes(kw)) score += 2;
        });
        return score;
    }

    const RESULT_LIMIT = 60;

    /**
     * 서버가 보내 준 점수표(base64)를 계산하기 좋은 모양으로 푼다.
     * table: { ids, unique(점수를 매길 행 번호 - 거의 같은 이미지는 대표 하나만), labels, scores: { 키워드: base64(Int16, z점수×1000) },
     *          subjects: { 주제: base64(Uint16, 확률×65535) }, thresholds, rejected: { 키워드: [핀 id] } }
     */
    function decodeFeelTable(table, decodeBase64) {
        const int16 = (b64) => { const bytes = decodeBase64(b64); return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2); };
        const uint16 = (b64) => { const bytes = decodeBase64(b64); return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2); };
        const rowOf = new Map(table.ids.map((id, i) => [id, i]));
        const scores = {}, subjects = {}, rejected = {};
        Object.entries(table.scores).forEach(([k, b64]) => { scores[k] = int16(b64); });
        Object.entries(table.subjects).forEach(([s, b64]) => { subjects[s] = uint16(b64); });
        Object.entries(table.rejected || {}).forEach(([k, pins]) => { rejected[k] = new Set(pins); });
        const thresholds = {};
        Object.entries(table.thresholds).forEach(([s, t]) => { thresholds[s] = Math.ceil(t * 65535 - 1e-6); });
        return {
            ids: table.ids,
            labels: table.labels,
            rowOf,
            uniqueRows: table.unique,
            scores,
            subjects,
            thresholds,
            rejected,
            hasSubject: (subjectId, pinId) => {
                const row = rowOf.get(pinId);
                return row !== undefined && subjects[subjectId][row] >= thresholds[subjectId];
            }
        };
    }

    /**
     * 터널 검색 전체: 느낌 키워드("차가운")나 주제어("사람 없는")를 알아들으면 점수표로, 아니면 글자로 찾는다.
     * docs: [{ pin, doc, sourcePinId }] - 터널 주인의 핀들. feel: decodeFeelTable 결과 (없으면 글자 검색만)
     */
    function rankSearch(query, { parser, docs, feel }) {
        const rawQuery = String(query || '').trim();
        const keywords = Array.from(new Set(rawQuery.toLowerCase().split(/\s+/).filter(Boolean)));

        const analyzed = new Map();
        if (feel) docs.forEach((d) => { if (d.sourcePinId && feel.rowOf.has(d.sourcePinId)) analyzed.set(d.sourcePinId, d); });

        let feelResult = { keywords: [], include: [], exclude: [], unknown: keywords, pins: [] };
        if (analyzed.size) {
            const subjects = parser.parseSubjects(rawQuery);
            const include = subjects.include;
            const exclude = subjects.exclude.filter((id) => !include.includes(id));
            const { ids, unknown } = parser.parseKeywords(subjects.rest);
            const rejected = new Set();
            ids.forEach((id) => { (feel.rejected[id] || new Set()).forEach((pin) => rejected.add(pin)); });
            const allowedRow = (row) => {
                const pin = feel.ids[row];
                return analyzed.has(pin) && !rejected.has(pin)
                    && include.every((s) => feel.subjects[s][row] >= feel.thresholds[s])
                    && !exclude.some((s) => feel.subjects[s][row] >= feel.thresholds[s]);
            };

            let ranked = [];
            if (ids.length) {
                const tables = ids.map((id) => feel.scores[id]);
                ranked = feel.uniqueRows.filter(allowedRow)
                    .map((row) => { let s = Infinity; tables.forEach((t) => { if (t[row] < s) s = t[row]; }); return { row, score: s }; });
            } else if (include.length) {
                // 느낌 키워드 없이 주제만 쓴 경우 ("옷") - 그 주제가 확실한 순서대로
                ranked = feel.uniqueRows.filter(allowedRow)
                    .map((row) => { let s = Infinity; include.forEach((sub) => { if (feel.subjects[sub][row] < s) s = feel.subjects[sub][row]; }); return { row, score: s }; });
            }
            ranked.sort((a, b) => b.score - a.score);
            feelResult = {
                keywords: ids,
                include,
                exclude,
                unknown,
                pins: ranked.slice(0, RESULT_LIMIT).map(({ row, score }) => ({ id: feel.ids[row], score }))
            };
        }

        const feelActive = feelResult.keywords.length > 0 || feelResult.include.length > 0;
        // 감각 검색이 알아듣지 못한 나머지 말은 글자 검색으로 찾는다 (아무것도 못 알아들었으면 검색어 전체)
        const textKeywords = feelActive || feelResult.exclude.length ? feelResult.unknown : keywords;
        const excluded = (d) => d.sourcePinId && feelResult.exclude.some((s) => feel.hasSubject(s, d.sourcePinId));

        let ranked;
        if (feelActive) {
            ranked = feelResult.pins.map((p) => ({ d: analyzed.get(p.id), score: p.score }));
            // 남은 말까지 맞는 핀이 있으면 그것만 남긴다 (없으면 남은 말은 무시하고 감각 결과를 그대로)
            if (textKeywords.length) {
                const narrowed = ranked.filter(({ d }) => scoreTextMatch(d.doc, textKeywords) !== null);
                if (narrowed.length) ranked = narrowed;
            }
            // 그 사람이 감각 테스트로 직접 고른(그 단어를 키워드로 붙인) 핀이 AI 해석보다 먼저다
            // (주제어만 쓴 검색 "포스터"는 그대로 둔다 - 감각 테스트는 느낌 단어에 대한 것)
            const ownPicks = feelResult.keywords.length
                ? docs.filter((d) => keywords.every((kw) => d.doc.tags.some((t) => t.includes(kw))))
                : [];
            if (ownPicks.length) {
                const picked = new Set(ownPicks);
                ranked = [...ownPicks.map((d) => ({ d, score: Infinity })), ...ranked.filter(({ d }) => !picked.has(d))];
            }
        } else {
            ranked = [];
            if (textKeywords.length) {
                docs.forEach((d) => {
                    if (excluded(d)) return;
                    const score = scoreTextMatch(d.doc, textKeywords);
                    if (score !== null) ranked.push({ d, score });
                });
                ranked.sort((a, b) => b.score - a.score);
            }
        }

        return {
            query: rawQuery,
            keywords,
            total: ranked.length,
            // 검색어를 어떻게 알아들었는지 (검색창 아래에 표시)
            understood: {
                feel: feelResult.keywords.map((id) => feel.labels.keywords[id]),
                include: feelResult.include.map((id) => feel.labels.subjects[id]),
                exclude: feelResult.exclude.map((id) => feel.labels.subjects[id]),
                text: textKeywords
            },
            pins: ranked.slice(0, RESULT_LIMIT).map(({ d }) => d.pin)
        };
    }

    return { createQueryParser, toSearchDoc, scoreTextMatch, decodeFeelTable, rankSearch, RESULT_LIMIT };
});
