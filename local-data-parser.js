/**
 * Pinterest 데이터 파서
 * 다운로드한 Pinterest 데이터 파일을 JSON으로 변환합니다
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

/**
 * HTML에서 JSON 데이터 추출
 * Pinterest의 your_pins.html 파일을 파싱합니다
 */
function parseYourPinsHTML(filePath) {
    try {
        const html = fs.readFileSync(filePath, 'utf8');
        
        // JSON 데이터를 찾기 위해 패턴 매칭
        const jsonMatch = html.match(/var\s+allItems\s*=\s*(\[[\s\S]*?\]);/);
        if (!jsonMatch) {
            console.log('JSON 데이터를 찾을 수 없습니다. 다른 패턴 시도 중...');
            return parseFromHTMLStructure(html);
        }
        
        const jsonString = jsonMatch[1];
        const pins = JSON.parse(jsonString);
        
        // 핀 데이터 정규화
        return pins.map(pin => ({
            id: pin.id || Math.random().toString(36),
            title: pin.title || pin.name || '제목 없음',
            description: pin.description || pin.note || '',
            image: pin.image || pin.imageUrl || '',
            link: pin.link || pin.url || '',
            creator: pin.creator || pin.creatorName || '알 수 없음',
            color: pin.color || pin.dominantColor || '#667eea',
            createdAt: pin.createdAt || pin.created || new Date().toISOString()
        }));
    } catch (error) {
        console.error('HTML 파싱 에러:', error.message);
        return [];
    }
}

/**
 * HTML 구조에서 핀 정보 추출
 */
function parseFromHTMLStructure(html) {
    const pins = [];
    
    // <article> 또는 <div class="pin"> 태그 찾기
    const pinRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    let match;
    
    while ((match = pinRegex.exec(html)) !== null) {
        const pinHTML = match[1];
        
        // 이미지 URL 추출
        const imgMatch = pinHTML.match(/src="([^"]*\.(?:jpg|jpeg|png|gif|webp))/i);
        const image = imgMatch ? imgMatch[1] : '';
        
        // 제목 추출
        const titleMatch = pinHTML.match(/<h[1-6][^>]*>([^<]*)<\/h[1-6]>/i);
        const title = titleMatch ? titleMatch[1].trim() : '제목 없음';
        
        // 설명 추출
        const descMatch = pinHTML.match(/<p[^>]*>([^<]*)<\/p>/i);
        const description = descMatch ? descMatch[1].trim() : '';
        
        if (image || title) {
            pins.push({
                id: Math.random().toString(36),
                title: title,
                description: description,
                image: image,
                link: '',
                creator: '내 핀',
                color: '#667eea',
                createdAt: new Date().toISOString()
            });
        }
    }
    
    return pins;
}

/**
 * GET /api/local-pins
 * 로컬 Pinterest 데이터 파일에서 핀 가져오기
 */
router.get('/local-pins', (req, res) => {
    const pinsPath = path.join(process.env.HOME || '', 'Downloads', 'pinterest', 'pins', 'your_pins.html');
    
    if (!fs.existsSync(pinsPath)) {
        return res.status(404).json({
            error: 'Pinterest 데이터 파일을 찾을 수 없습니다',
            path: pinsPath,
            hint: '~/Downloads/pinterest/pins/your_pins.html 파일이 있는지 확인하세요'
        });
    }
    
    try {
        const pins = parseYourPinsHTML(pinsPath);
        
        if (pins.length === 0) {
            return res.status(400).json({
                error: 'Pinterest 데이터를 파싱할 수 없습니다',
                hint: '파일 형식이 올바른지 확인하세요'
            });
        }
        
        res.json({
            success: true,
            source: 'local_pinterest_data',
            count: pins.length,
            pins: pins
        });
    } catch (error) {
        res.status(500).json({
            error: '파일 처리 중 오류 발생',
            message: error.message
        });
    }
});

module.exports = router;
