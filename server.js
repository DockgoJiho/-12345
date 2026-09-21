/**
 * Pinterest 파티클 갤러리 - 백엔드 서버
 * 핀 데이터는 Supabase(Postgres)에 사용자별로 저장된다.
 * 메모/키워드 수정, 삭제처럼 단순한 단건 쓰기는 프론트엔드가 Supabase에 직접 요청하고
 * (Row Level Security가 "본인 소유 핀만" 규칙을 강제한다), 여기 서버는 가중치 검색·관련
 * 이미지 추천처럼 로직이 있는 읽기 요청과, 로그인한 사용자의 핀 일괄 가져오기(/api/pins/import)만
 * 담당한다.
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const { CATEGORY_TAXONOMY, getCategoryByKey } = require('./categories');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

// 상수
const PINTEREST_API_BASE = 'https://api.pinterest.com/v5';
const ACCESS_TOKEN = process.env.PINTEREST_ACCESS_TOKEN;

// ?user= 없이 들어온 요청(기존 gallery.html, gallery.html?pin=..., ?q=... 링크들)이
// 가리킬 기본 아카이브 - 마이그레이션으로 실제 계정을 만든 뒤 그 사용자명으로 설정한다.
const DEFAULT_ARCHIVE_USERNAME = process.env.DEFAULT_ARCHIVE_USERNAME || '';

// 익명 키로 만든 클라이언트 - 공개 읽기 전용(RLS의 select using(true) 정책을 탄다)
const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 에러 핸들링
const handleApiError = (error, res) => {
    console.error('Pinterest API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || 'API 호출 실패',
        details: error.message
    });
};

/**
 * Supabase의 pins 행(snake_case)을 프론트엔드가 기대하는 기존 API 응답 형태(camelCase)로 변환한다.
 */
function mapPin(row) {
    return {
        id: row.id,
        ownerId: row.owner_id,
        title: row.title || '제목 없음',
        description: row.description || '',
        image: row.image || '',
        link: row.link || '',
        creator: row.creator || '내 저장 핀',
        color: row.color || '#667eea',
        createdAt: row.created_at || new Date().toISOString(),
        memo: row.memo || '',
        customTags: row.custom_tags || [],
        category: row.category || null,
        colorType: row.color_type || null,
        mainColor: row.main_color || null
    };
}

/**
 * Supabase(PostgREST)는 한 번의 select로 최대 max_rows(기본 1000)개까지만 돌려준다.
 * 소유자 한 명의 핀이 1000개를 넘으면 조용히 잘려나가므로, .range()로 페이지를 넘기며
 * 전부 모을 때까지 반복한다.
 */
async function fetchAllPins(ownerId, columns = '*') {
    const PAGE_SIZE = 1000;
    const rows = [];
    let from = 0;

    while (true) {
        const { data, error } = await supabaseAnon
            .from('pins')
            .select(columns)
            .eq('owner_id', ownerId)
            .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        rows.push(...(data || []));

        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return rows;
}

/**
 * 사용자명 → { id, username }. 생략되면 기본 아카이브(DEFAULT_ARCHIVE_USERNAME)를 사용한다.
 * 존재하지 않는 사용자명이면 null을 돌려주고, 호출부는 "핀 0개"로 취급한다.
 */
async function resolveOwner(username) {
    const targetUsername = (username || DEFAULT_ARCHIVE_USERNAME || '').trim();
    if (!targetUsername) return null;

    const { data, error } = await supabaseAnon
        .from('profiles')
        .select('id, username')
        .eq('username', targetUsername)
        .maybeSingle();

    if (error || !data) return null;
    return data;
}

/**
 * 로그인한 사용자의 요청인지 확인하고, 그 사용자 권한으로 동작하는 Supabase 클라이언트를 만든다.
 * (RLS의 auth.uid() = owner_id 같은 정책이 이 클라이언트를 통한 요청에도 그대로 적용된다.)
 */
function supabaseForRequest(req) {
    const authHeader = req.headers.authorization || '';
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } }
    });
}

/**
 * 특정 사용자의 저장된 핀 목록 가져오기 (?user=사용자명, 생략 시 기본 아카이브)
 */
// 터널에는 한 번에 최대 200개만 보여주므로, 매번 소유자의 핀 전체(수천 개까지 갈 수 있다)를
// 통째로 내려받을 필요가 없다 - 무작위 표본을 뽑기에 충분히 큰 한 페이지(SAMPLE_POOL_SIZE)만
// 가져와서 그 안에서 섞는다. 정확한 총 개수는 행 데이터를 전혀 내려받지 않는 count 쿼리로 별도 조회한다.
const PINS_SAMPLE_POOL_SIZE = 600;

app.get('/api/pins', async (req, res) => {
    try {
        const owner = await resolveOwner(req.query.user);
        if (!owner) {
            return res.json({ success: true, source: 'supabase', count: 0, total: 0, owner: null, pins: [] });
        }

        const [{ data: rows, error: rowsError }, { count: totalCount, error: countError }] = await Promise.all([
            supabaseAnon
                .from('pins')
                .select('*')
                .eq('owner_id', owner.id)
                .not('image', 'is', null)
                .neq('image', '')
                .limit(PINS_SAMPLE_POOL_SIZE),
            supabaseAnon
                .from('pins')
                .select('id', { count: 'exact', head: true })
                .eq('owner_id', owner.id)
                .not('image', 'is', null)
                .neq('image', '')
        ]);

        if (rowsError) throw rowsError;
        if (countError) throw countError;

        // 매 요청마다 무작위로 섞어서 다양하게 보여준다
        const shuffled = [...(rows || [])];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const pins = shuffled.slice(0, 200).map(mapPin);

        res.json({ success: true, source: 'supabase', count: pins.length, total: totalCount || 0, owner, pins });
    } catch (error) {
        console.error('핀 목록 조회 실패:', error.message);
        res.status(500).json({ error: '핀 목록을 불러오지 못했습니다' });
    }
});

/**
 * 대범주 카테고리별 핀 개수 집계 (메인 페이지의 ARCHIVE INDEX용). ?user=사용자명
 */
app.get('/api/categories', async (req, res) => {
    try {
        const owner = await resolveOwner(req.query.user);
        if (!owner) {
            return res.json({ success: true, total: 0, categories: [] });
        }

        const rows = await fetchAllPins(owner.id, 'category, image');

        const withImage = rows.filter((pin) => !!pin.image);
        const counts = {};
        withImage.forEach((pin) => {
            if (!pin.category) return;
            counts[pin.category] = (counts[pin.category] || 0) + 1;
        });

        const categories = Object.entries(counts)
            .map(([key, count]) => {
                const cat = getCategoryByKey(key);
                return { key, name: cat ? cat.en : key, ko: cat ? cat.ko : key, count };
            })
            .sort((a, b) => b.count - a.count);

        res.json({ success: true, total: withImage.length, categories });
    } catch (error) {
        console.error('카테고리 집계 실패:', error.message);
        res.status(500).json({ error: '카테고리를 불러오지 못했습니다' });
    }
});

/**
 * 특정 사용자의 핀 안에서 키워드로 검색 (제목/설명/메모/키워드까지 전부 대상). ?user=사용자명
 * q에 공백으로 여러 키워드를 넘기면 태그처럼 누적되어 전부 만족하는 핀만 남는(AND) 방식으로
 * 점점 더 특정 이미지로 좁혀지고, 결과는 관련도 점수순으로 정렬되어 터널 안 검색 패널에 표시된다.
 */
const COLOR_TYPE_TERMS = {
    monochrome: ['monochrome', '모노크롬', '흑백', '무채색', '단색'],
    polychrome: ['polychrome', '폴리크롬', '유채색', '다채색']
};

/**
 * 메인 색상 검색어 확장: "파랑"은 되는데 "파랑색"은 안 되는 것처럼, 핀에 저장된 정확한
 * 표기(main_color.ko)와 실제로 사람들이 검색창에 치는 표현이 갈라지는 문제를 막기 위해
 * 색상마다 자주 쓰는 표현(정식/구어체 "-색" 표기, 영어, 카타카나식 외래어 표기 등)을
 * 전부 haystack에 미리 섞어 넣는다. data-key(main_color.key) 기준으로 관리한다.
 */
const MAIN_COLOR_SYNONYMS = {
    red: ['red', '빨강', '빨간색', '빨강색', '레드'],
    white: ['white', '흰색', '하양', '하얀색', '화이트'],
    teal: ['teal', '청록', '청록색', '틸'],
    beige: ['beige', '베이지', '베이지색'],
    pink: ['pink', '분홍', '분홍색', '핑크'],
    gray: ['gray', 'grey', '회색', '그레이', '회색빛'],
    black: ['black', '검정', '검정색', '검은색', '블랙'],
    blue: ['blue', '파랑', '파란색', '파랑색', '블루'],
    navy: ['navy', '남색', '남색빛', '네이비'],
    brown: ['brown', '갈색', '브라운'],
    orange: ['orange', '주황', '주황색', '오렌지'],
    yellow: ['yellow', '노랑', '노란색', '노랑색', '옐로우', '옐로'],
    purple: ['purple', 'violet', '보라', '보라색', '퍼플', '바이올렛'],
    green: ['green', '초록', '초록색', '그린']
};

app.get('/api/pins/search', async (req, res) => {
    const rawQuery = String(req.query.q || '').trim();

    if (!rawQuery) {
        return res.status(400).json({ error: '검색어가 필요합니다' });
    }

    const keywords = Array.from(new Set(rawQuery.toLowerCase().split(/\s+/).filter(Boolean)));

    try {
        const owner = await resolveOwner(req.query.user);
        if (!owner) {
            return res.json({ success: true, query: rawQuery, keywords, total: 0, pins: [] });
        }

        const rows = await fetchAllPins(owner.id);

        const scored = [];
        rows.forEach((pin) => {
            if (!pin.image) return;

            const title = (pin.title || '').toLowerCase();
            const description = (pin.description || '').toLowerCase();
            const memo = (pin.memo || '').toLowerCase();
            const tags = Array.isArray(pin.custom_tags) ? pin.custom_tags.map((t) => String(t).toLowerCase()) : [];

            // 대범주/모노크롬-폴리크롬/메인색은 한글·영어 동의어를 전부 haystack에 섞어 넣어서,
            // "그래픽 아트"와 "Graphic Art"처럼 언어가 달라도 같은 대상으로 매칭되게 한다
            const categoryEntry = pin.category ? CATEGORY_TAXONOMY.find((c) => c.key === pin.category) : null;
            const categoryTerms = categoryEntry ? [categoryEntry.key, categoryEntry.en, categoryEntry.ko, ...categoryEntry.synonyms] : [];
            const colorTypeTerms = pin.color_type ? (COLOR_TYPE_TERMS[pin.color_type] || []) : [];
            const mainColorTerms = pin.main_color
                ? (MAIN_COLOR_SYNONYMS[pin.main_color.key] || [pin.main_color.key, pin.main_color.en, pin.main_color.ko])
                : [];

            const haystack = [
                title, description, memo, ...tags,
                ...categoryTerms, ...colorTypeTerms, ...mainColorTerms
            ].join(' ').toLowerCase();

            // 태그를 하나씩 추가할수록 특정성이 강해지도록, 모든 키워드를 만족해야만 후보에 남긴다
            const matchesAll = keywords.every((kw) => haystack.includes(kw));
            if (!matchesAll) return;

            // 필드별 가중치를 둔 관련도 점수: 직접 붙인 키워드 완전일치 > 대범주/색상 > 제목 > 메모 > 설명
            let score = 0;
            keywords.forEach((kw) => {
                if (tags.includes(kw)) score += 12;
                else if (tags.some((t) => t.includes(kw))) score += 8;
                if (categoryTerms.some((t) => t.toLowerCase() === kw)) score += 10;
                if (colorTypeTerms.includes(kw) || mainColorTerms.some((t) => t.toLowerCase() === kw)) score += 6;
                if (title.includes(kw)) score += 5;
                if (memo.includes(kw)) score += 3;
                if (description.includes(kw)) score += 2;
            });

            scored.push({ pin, score });
        });

        scored.sort((a, b) => b.score - a.score);

        const pins = scored.slice(0, 60).map(({ pin, score }) => ({ ...mapPin(pin), score }));

        res.json({ success: true, query: rawQuery, keywords, total: scored.length, pins });
    } catch (error) {
        console.error('검색 실패:', error.message);
        res.status(500).json({ error: '검색에 실패했습니다' });
    }
});

/**
 * id로 핀 하나만 조회 (메인 페이지 마퀴 카드 클릭 등, 샘플 목록에 없는 특정 핀을 바로 열 때 사용)
 */
app.get('/api/pin/:id', async (req, res) => {
    try {
        const { data: pin, error } = await supabaseAnon
            .from('pins')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle();

        if (error) throw error;
        if (!pin) return res.status(404).json({ error: '해당 핀을 찾을 수 없습니다' });

        res.json({ success: true, pin: mapPin(pin) });
    } catch (error) {
        console.error('핀 조회 실패:', error.message);
        res.status(500).json({ error: '핀을 불러오지 못했습니다' });
    }
});

/**
 * 특정 핀과 같은 사람의 핀 중에서, 대범주가 같은(필요하면 모노크롬/폴리크롬, 메인색도 반영)
 * 관련 핀을 추천한다. 상세 페이지의 "관련 이미지" 인터페이스에서 사용한다.
 */
app.get('/api/pins/:id/related', async (req, res) => {
    try {
        const { data: target, error: targetError } = await supabaseAnon
            .from('pins')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle();

        if (targetError) throw targetError;
        if (!target) return res.status(404).json({ error: '해당 핀을 찾을 수 없습니다' });

        const limit = Math.min(parseInt(req.query.limit, 10) || 12, 30);

        const rows = await fetchAllPins(target.owner_id);

        const scored = rows
            .filter((p) => p.id !== target.id && !!p.image)
            .map((p) => {
                let score = 0;
                if (target.category && p.category === target.category) score += 10;
                if (target.color_type && p.color_type === target.color_type) score += 3;
                if (target.main_color && p.main_color && p.main_color.key === target.main_color.key) score += 2;
                return { pin: p, score };
            })
            .filter((s) => s.score > 0);

        scored.sort((a, b) => b.score - a.score);

        const pins = scored.slice(0, limit).map(({ pin, score }) => ({ ...mapPin(pin), score }));

        res.json({ success: true, total: scored.length, pins });
    } catch (error) {
        console.error('관련 핀 조회 실패:', error.message);
        res.status(500).json({ error: '관련 핀을 불러오지 못했습니다' });
    }
});

/**
 * 로그인한 사용자가 자기 계정으로 핀 데이터를 일괄 등록한다.
 * Authorization: Bearer <supabase access token> 필요.
 * body: { pins: [{ id(원래 핀터레스트 id, 선택), title, description, image, link, creator,
 *                   color, category, colorType, mainColor, memo, customTags }, ...] }
 * RLS가 owner_id = auth.uid()인 행만 쓰도록 강제하므로, 여기서 owner_id는 항상 로그인한
 * 본인으로 고정한다(요청 body로 다른 사람 계정에 끼워넣을 수 없다).
 */
app.post('/api/pins/import', async (req, res) => {
    try {
        const authHeader = req.headers.authorization || '';
        if (!authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '로그인이 필요합니다' });
        }

        const supabaseUser = supabaseForRequest(req);
        const { data: userData, error: userError } = await supabaseUser.auth.getUser();
        if (userError || !userData.user) {
            return res.status(401).json({ error: '유효하지 않은 로그인입니다' });
        }

        const incomingPins = Array.isArray(req.body?.pins) ? req.body.pins : [];
        if (incomingPins.length === 0) {
            return res.status(400).json({ error: '가져올 핀 데이터가 없습니다' });
        }

        const rows = incomingPins
            .map((pin) => ({
                owner_id: userData.user.id,
                source_pin_id: pin.id ? String(pin.id) : null,
                title: pin.title || '제목 없음',
                description: pin.description || '',
                image: pin.image || '',
                link: pin.link || '',
                creator: pin.creator || '',
                color: pin.color || '#667eea',
                category: pin.category || null,
                color_type: pin.colorType || null,
                main_color: pin.mainColor || null,
                memo: pin.memo || '',
                custom_tags: Array.isArray(pin.customTags)
                    ? pin.customTags.filter((t) => typeof t === 'string' && t.trim())
                    : []
            }))
            .filter((row) => !!row.image);

        if (rows.length === 0) {
            return res.status(400).json({ error: '이미지가 있는 핀이 없습니다' });
        }

        const BATCH_SIZE = 500;
        let inserted = 0;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const { error } = await supabaseUser.from('pins').insert(batch);
            if (error) throw error;
            inserted += batch.length;
        }

        res.json({ success: true, inserted });
    } catch (error) {
        console.error('핀 가져오기 실패:', error.message);
        res.status(500).json({ error: '핀 가져오기에 실패했습니다' });
    }
});

/**
 * 특정 보드의 핀 가져오기 (Pinterest 실계정 연동 시 사용 - 아직 미사용)
 */
app.get('/api/board/:boardId/pins', async (req, res) => {
    try {
        if (!ACCESS_TOKEN) {
            return res.status(400).json({ error: 'Access Token이 필요합니다' });
        }

        const { boardId } = req.params;
        const params = {
            fields: 'id,created_at,creator,description,dominant_color,image,link,title',
            page_size: 50
        };

        const response = await axios.get(
            `${PINTEREST_API_BASE}/boards/${boardId}/pins`,
            {
                headers: {
                    'Authorization': `Bearer ${ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                params: params
            }
        );

        const pins = response.data.items.map(pin => ({
            id: pin.id,
            title: pin.title || '제목 없음',
            description: pin.description || '',
            image: pin.image?.original?.url || '',
            link: pin.link || '',
            creator: pin.creator?.username || '',
            color: pin.dominant_color || '#667eea'
        }));

        res.json({
            success: true,
            count: pins.length,
            pins: pins
        });

    } catch (error) {
        handleApiError(error, res);
    }
});

/**
 * 사용자의 모든 보드 가져오기 (Pinterest 실계정 연동 시 사용 - 아직 미사용)
 */
app.get('/api/boards', async (req, res) => {
    try {
        if (!ACCESS_TOKEN) {
            return res.status(400).json({ error: 'Access Token이 필요합니다' });
        }

        const params = {
            fields: 'id,name,description,pin_count',
            page_size: 20
        };

        const response = await axios.get(
            `${PINTEREST_API_BASE}/user/boards`,
            {
                headers: {
                    'Authorization': `Bearer ${ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                params: params
            }
        );

        const boards = response.data.items.map(board => ({
            id: board.id,
            name: board.name,
            description: board.description || '',
            pinCount: board.pin_count || 0
        }));

        res.json({
            success: true,
            count: boards.length,
            boards: boards
        });

    } catch (error) {
        handleApiError(error, res);
    }
});

/**
 * 핀 검색 (Pinterest 실계정 연동 시 사용 - 아직 미사용, /api/pins/search와는 별개)
 */
app.get('/api/search', async (req, res) => {
    try {
        if (!ACCESS_TOKEN) {
            return res.status(400).json({ error: 'Access Token이 필요합니다' });
        }

        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: '검색어가 필요합니다' });
        }

        const params = {
            query: query,
            fields: 'id,created_at,creator,description,dominant_color,image,link,title',
            page_size: 30
        };

        const response = await axios.get(
            `${PINTEREST_API_BASE}/search/pins`,
            {
                headers: {
                    'Authorization': `Bearer ${ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                params: params
            }
        );

        const pins = response.data.items.map(pin => ({
            id: pin.id,
            title: pin.title || '제목 없음',
            description: pin.description || '',
            image: pin.image?.original?.url || '',
            link: pin.link || '',
            creator: pin.creator?.username || '',
            color: pin.dominant_color || '#667eea'
        }));

        res.json({
            success: true,
            count: pins.length,
            pins: pins
        });

    } catch (error) {
        handleApiError(error, res);
    }
});

/**
 * 이미지 프록시 엔드포인트 (CORS 우회)
 * Pinterest CDN 이미지를 프록시로 제공하여 CORS 문제 해결
 */
app.get('/api/image', async (req, res) => {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'URL 파라미터가 필요합니다' });
        }

        // Pinterest CDN URL만 허용 (보안)
        if (!url.startsWith('https://i.pinimg.com/')) {
            return res.status(403).json({ error: '허용되지 않은 도메인입니다' });
        }

        console.log(`📥 이미지 프록시: ${url.substring(0, 50)}...`);

        const imageResponse = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://www.pinterest.com/'
            }
        });

        // 이미지 타입 감지 및 캐시 헤더 설정
        const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 24시간 캐시
        res.setHeader('Access-Control-Allow-Origin', '*');

        res.send(imageResponse.data);

    } catch (error) {
        console.error('이미지 프록시 에러:', error.message);
        res.status(500).json({ error: '이미지 로드 실패' });
    }
});

/**
 * 헬스 체크 및 API 상태 확인
 */
app.get('/api/status', (req, res) => {
    const hasToken = !!ACCESS_TOKEN && ACCESS_TOKEN !== 'your_access_token_here';
    res.json({
        status: 'ok',
        server: 'running',
        hasAccessToken: hasToken,
        hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
        apiVersion: 'Pinterest v5'
    });
});

/**
 * 메인 페이지 제공
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎨 Pinterest 파티클 갤러리 서버 실행 중`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`\n🔧 API 엔드포인트:`);
    console.log(`   GET  /api/pins?user=...     - 특정 사용자의 핀 목록`);
    console.log(`   GET  /api/pins/search?q=...&user=... - 핀 검색`);
    console.log(`   GET  /api/pins/:id/related  - 관련 핀`);
    console.log(`   POST /api/pins/import       - 로그인한 사용자의 핀 일괄 등록`);
    console.log(`   GET  /api/status            - 서버 상태`);
    console.log(`\n${process.env.SUPABASE_URL ? '✓  Supabase 연동됨' : '⚠️  .env 파일에 SUPABASE_URL/SUPABASE_ANON_KEY를 설정하세요'}`);
    console.log(`${'='.repeat(60)}\n`);
});

module.exports = app;
