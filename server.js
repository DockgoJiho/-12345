/**
 * Pinterest 파티클 갤러리 - 백엔드 서버
 * Pinterest API v5를 통해 실제 핀 데이터를 가져옵니다
 * 또는 로컬 다운로드 데이터를 사용할 수 있습니다
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const os = require('os');

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
const HOME_DIR = process.env.HOME || os.homedir();

// 에러 핸들링
const handleApiError = (error, res) => {
    console.error('Pinterest API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
        error: error.response?.data?.message || 'API 호출 실패',
        details: error.message
    });
};

/**
 * 로컬 Pinterest 데이터 로드 (JSON 파일)
 */
let cachedLocalPins = null;

function loadLocalPinsJSON() {
    if (cachedLocalPins) {
        return cachedLocalPins;
    }
    
    const localPinsPath = path.join(__dirname, 'local_pins.json');
    
    if (!fs.existsSync(localPinsPath)) {
        return null;
    }
    
    try {
        const data = fs.readFileSync(localPinsPath, 'utf8');
        cachedLocalPins = JSON.parse(data);
        console.log(`✓ 로컬 데이터 캐시 로드: ${cachedLocalPins.length}개 핀`);
        return cachedLocalPins;
    } catch (error) {
        console.error('로컬 데이터 로드 실패:', error.message);
        return null;
    }
}

/**
 * 로컬 핀 데이터를 API 응답 형태로 변환 (모노크롬/폴리크롬, 메인색, 대범주까지 포함)
 */
function mapPin(pin) {
    return {
        id: pin.id || Math.random().toString(36),
        title: pin.title || '제목 없음',
        description: pin.description || '',
        image: pin.image || '',
        link: pin.link || '',
        creator: pin.creator || '내 저장 핀',
        color: pin.color || '#667eea',
        createdAt: pin.createdAt || new Date().toISOString(),
        memo: pin.memo || '',
        customTags: pin.customTags || [],
        category: pin.category || null,
        colorType: pin.colorType || null,
        mainColor: pin.mainColor || null
    };
}

/**
 * 로컬 Pinterest 데이터 파싱
 */
function parseLocalPinterestData() {
    const localPins = loadLocalPinsJSON();

    if (localPins && localPins.length > 0) {
        // 로컬에 실제 이미지 파일이 있는 핀을 우선으로, 매 요청마다 무작위로 섞어서
        // 다양한 핀이 나오도록 한다 (최대 200개, 성능과 다양성의 균형)
        const withLocalImage = localPins.filter((pin) => pin.image && pin.image.startsWith('/images/'));
        const pool = withLocalImage.length > 0 ? withLocalImage : localPins;

        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const pins = shuffled.slice(0, 200).map(mapPin);

        // total: 화면에 실제로 뿌리는 개수(최대 200)가 아니라, 이미지가 있는 핀 전체 개수.
        // 나중에 핀이 더 늘어나면(재다운로드/추가) 이 값도 자동으로 커진다.
        return { pins, total: pool.length };
    }

    return null;
}

/**
 * 사용자의 저장된 모든 핀 가져오기
 * 1. 로컬 데이터 우선 사용
 * 2. 로컬 데이터 없으면 API 사용
 */
app.get('/api/pins', async (req, res) => {
    try {
        // 1단계: 로컬 데이터 먼저 시도
        const localData = parseLocalPinterestData();
        if (localData && localData.pins.length > 0) {
            console.log(`✓ 로컬 데이터에서 ${localData.pins.length}개의 핀을 로드했습니다 (전체 ${localData.total}개)`);
            return res.json({
                success: true,
                source: 'local_data',
                count: localData.pins.length,
                total: localData.total,
                pins: localData.pins
            });
        }
        
        // 2단계: API 사용
        if (!ACCESS_TOKEN || ACCESS_TOKEN === 'your_access_token_here') {
            return res.status(400).json({
                error: 'Access Token이 설정되지 않았고 로컬 데이터도 없습니다',
                hint: '.env 파일에 PINTEREST_ACCESS_TOKEN을 설정하거나 ~/Downloads/pinterest/pins/your_pins.html 파일을 확인하세요'
            });
        }

        const params = {
            fields: 'id,created_at,creator,description,dominant_color,image,link,title,media',
            page_size: 50
        };

        console.log('Pinterest API 요청: /v5/user/saved_pins');
        
        const response = await axios.get(
            `${PINTEREST_API_BASE}/user/saved_pins`,
            {
                headers: {
                    'Authorization': `Bearer ${ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                params: params
            }
        );

        // 데이터 변환
        const pins = response.data.items.map(pin => ({
            id: pin.id,
            title: pin.title || '제목 없음',
            description: pin.description || '설명 없음',
            image: pin.image?.original?.url || '',
            link: pin.link || '',
            creator: pin.creator?.username || '알 수 없음',
            color: pin.dominant_color || '#667eea',
            createdAt: pin.created_at
        }));

        console.log(`✓ ${pins.length}개의 핀을 Pinterest API에서 가져왔습니다`);

        res.json({
            success: true,
            source: 'pinterest_api',
            count: pins.length,
            pins: pins
        });

    } catch (error) {
        handleApiError(error, res);
    }
});

/**
 * 대범주 카테고리별 핀 개수 집계 (메인 페이지의 ARCHIVE INDEX용).
 * 각 핀에 이미 부여된 category(대범주) 필드를 그대로 집계한다.
 */
app.get('/api/categories', (req, res) => {
    const localPins = loadLocalPinsJSON();

    if (!localPins || localPins.length === 0) {
        return res.json({ success: true, total: 0, categories: [] });
    }

    const withLocalImage = localPins.filter((pin) => pin.image && pin.image.startsWith('/images/'));
    const counts = {};

    withLocalImage.forEach((pin) => {
        if (!pin.category) return;
        counts[pin.category] = (counts[pin.category] || 0) + 1;
    });

    const categories = Object.entries(counts)
        .map(([key, count]) => {
            const cat = getCategoryByKey(key);
            return { key, name: cat ? cat.en : key, ko: cat ? cat.ko : key, count };
        })
        .sort((a, b) => b.count - a.count);

    res.json({ success: true, total: withLocalImage.length, categories });
});

/**
 * 로컬 데이터 안에서 키워드로 검색 (제목/설명/내가 남긴 메모/내가 추가한 키워드까지 전부 대상).
 * q에 공백으로 여러 키워드를 넘기면 태그처럼 누적되어 전부 만족하는 핀만 남는(AND) 방식으로
 * 점점 더 특정 이미지로 좁혀지고, 결과는 관련도 점수순으로 정렬되어 터널 안 검색 패널에 표시된다.
 */
const COLOR_TYPE_TERMS = {
    monochrome: ['monochrome', '모노크롬', '흑백', '무채색', '단색'],
    polychrome: ['polychrome', '폴리크롬', '유채색', '다채색']
};

app.get('/api/pins/search', (req, res) => {
    const rawQuery = String(req.query.q || '').trim();

    if (!rawQuery) {
        return res.status(400).json({ error: '검색어가 필요합니다' });
    }

    const keywords = Array.from(new Set(rawQuery.toLowerCase().split(/\s+/).filter(Boolean)));

    const localPins = loadLocalPinsJSON();
    if (!localPins) {
        return res.json({ success: true, query: rawQuery, keywords, total: 0, pins: [] });
    }

    const scored = [];
    localPins.forEach((pin) => {
        if (!pin.image || !pin.image.startsWith('/images/')) return;

        const title = (pin.title || '').toLowerCase();
        const description = (pin.description || '').toLowerCase();
        const memo = (pin.memo || '').toLowerCase();
        const tags = Array.isArray(pin.customTags) ? pin.customTags.map((t) => String(t).toLowerCase()) : [];

        // 대범주/모노크롬-폴리크롬/메인색은 한글·영어 동의어를 전부 haystack에 섞어 넣어서,
        // "그래픽 아트"와 "Graphic Art"처럼 언어가 달라도 같은 대상으로 매칭되게 한다
        const categoryEntry = pin.category ? CATEGORY_TAXONOMY.find((c) => c.key === pin.category) : null;
        const categoryTerms = categoryEntry ? [categoryEntry.key, categoryEntry.en, categoryEntry.ko, ...categoryEntry.synonyms] : [];
        const colorTypeTerms = pin.colorType ? (COLOR_TYPE_TERMS[pin.colorType] || []) : [];
        const mainColorTerms = pin.mainColor ? [pin.mainColor.key, pin.mainColor.en, pin.mainColor.ko] : [];

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
});

/**
 * id로 핀 하나만 조회 (메인 페이지 마퀴 카드 클릭 등, 샘플 목록에 없는 특정 핀을 바로 열 때 사용)
 */
app.get('/api/pin/:id', (req, res) => {
    const localPins = loadLocalPinsJSON();
    if (!localPins) {
        return res.status(404).json({ error: '로컬 핀 데이터가 없습니다' });
    }
    const pin = localPins.find((p) => String(p.id) === String(req.params.id));
    if (!pin) {
        return res.status(404).json({ error: '해당 핀을 찾을 수 없습니다' });
    }
    res.json({ success: true, pin: mapPin(pin) });
});

/**
 * 특정 핀과 대범주가 같은(필요하면 모노크롬/폴리크롬, 메인색도 반영) 관련 핀 추천.
 * 상세 페이지의 "관련 이미지" 인터페이스에서 사용한다.
 */
app.get('/api/pins/:id/related', (req, res) => {
    const localPins = loadLocalPinsJSON();
    if (!localPins) {
        return res.json({ success: true, pins: [] });
    }

    const target = localPins.find((p) => String(p.id) === String(req.params.id));
    if (!target) {
        return res.status(404).json({ error: '해당 핀을 찾을 수 없습니다' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 12, 30);

    const candidates = localPins.filter((p) =>
        String(p.id) !== String(target.id) &&
        p.image && p.image.startsWith('/images/')
    );

    const scored = candidates.map((p) => {
        let score = 0;
        if (target.category && p.category === target.category) score += 10;
        if (target.colorType && p.colorType === target.colorType) score += 3;
        if (target.mainColor && p.mainColor && p.mainColor.key === target.mainColor.key) score += 2;
        return { pin: p, score };
    }).filter((s) => s.score > 0);

    scored.sort((a, b) => b.score - a.score);

    const pins = scored.slice(0, limit).map(({ pin, score }) => ({ ...mapPin(pin), score }));

    res.json({ success: true, total: scored.length, pins });
});

/**
 * 핀을 아카이브에서 삭제한다 (터널에서 이미지 우클릭 → 삭제).
 * local_pins.json에서 제거하고, 로컬에 받아둔 이미지 파일도 함께 지운다.
 */
app.delete('/api/pins/:id', (req, res) => {
    const localPinsPath = path.join(__dirname, 'local_pins.json');
    if (!fs.existsSync(localPinsPath)) {
        return res.status(404).json({ error: '로컬 핀 데이터가 없습니다' });
    }

    const localPins = loadLocalPinsJSON();
    const index = localPins.findIndex((p) => String(p.id) === String(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: '해당 핀을 찾을 수 없습니다' });
    }

    const [removed] = localPins.splice(index, 1);
    fs.writeFileSync(localPinsPath, JSON.stringify(localPins, null, 2), 'utf8');
    cachedLocalPins = localPins;

    if (removed.image && removed.image.startsWith('/images/')) {
        const imagePath = path.join(__dirname, removed.image.replace(/^\//, ''));
        fs.unlink(imagePath, () => {
            // 파일이 이미 없거나 지우기 실패해도 핀 자체는 이미 목록에서 빠졌으니 무시한다
        });
    }

    res.json({ success: true, id: removed.id });
});

/**
 * 핀에 대한 개인 메모 저장 (나중에 키워드+메모 통합 검색에도 쓰인다)
 */
app.post('/api/memo', (req, res) => {
    const { id, memo } = req.body || {};

    if (!id) {
        return res.status(400).json({ error: 'id가 필요합니다' });
    }

    const localPinsPath = path.join(__dirname, 'local_pins.json');
    if (!fs.existsSync(localPinsPath)) {
        return res.status(404).json({ error: '로컬 핀 데이터가 없습니다' });
    }

    const localPins = loadLocalPinsJSON();
    const pin = localPins.find((p) => p.id === id);

    if (!pin) {
        return res.status(404).json({ error: '해당 핀을 찾을 수 없습니다' });
    }

    pin.memo = memo || '';
    fs.writeFileSync(localPinsPath, JSON.stringify(localPins, null, 2), 'utf8');
    cachedLocalPins = localPins;

    res.json({ success: true });
});

/**
 * 핀에 사용자가 직접 추가한 키워드 저장 (전체 목록을 교체)
 */
app.post('/api/tags', (req, res) => {
    const { id, tags } = req.body || {};

    if (!id) {
        return res.status(400).json({ error: 'id가 필요합니다' });
    }

    const localPinsPath = path.join(__dirname, 'local_pins.json');
    if (!fs.existsSync(localPinsPath)) {
        return res.status(404).json({ error: '로컬 핀 데이터가 없습니다' });
    }

    const localPins = loadLocalPinsJSON();
    const pin = localPins.find((p) => p.id === id);

    if (!pin) {
        return res.status(404).json({ error: '해당 핀을 찾을 수 없습니다' });
    }

    pin.customTags = Array.isArray(tags) ? tags.filter((t) => typeof t === 'string' && t.trim()) : [];
    fs.writeFileSync(localPinsPath, JSON.stringify(localPins, null, 2), 'utf8');
    cachedLocalPins = localPins;

    res.json({ success: true, customTags: pin.customTags });
});

/**
 * 특정 보드의 핀 가져오기
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
 * 사용자의 모든 보드 가져오기
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
 * 핀 검색
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
    console.log(`   GET  /api/pins              - 저장된 핀 목록`);
    console.log(`   POST /api/memo              - 핀 메모 저장`);
    console.log(`   POST /api/tags              - 핀 키워드 저장`);
    console.log(`   GET  /api/boards            - 보드 목록`);
    console.log(`   GET  /api/board/:id/pins    - 특정 보드의 핀`);
    console.log(`   GET  /api/search?query=...  - 핀 검색`);
    console.log(`   GET  /api/status            - 서버 상태`);
    console.log(`\n${!ACCESS_TOKEN || ACCESS_TOKEN === 'your_access_token_here' ? 
        '⚠️  .env 파일에 PINTEREST_ACCESS_TOKEN을 설정하세요' : 
        '✓  Pinterest API 토큰 설정됨'}`);
    console.log(`${'='.repeat(60)}\n`);
});

module.exports = app;
