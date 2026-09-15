/**
 * 메인 랜딩 페이지
 * - 상단 배너: 실제 핀 이미지들이 한 방향으로 흐르는 필름스트립 (최근에 자세히 본 이미지 우선)
 * - ARCHIVE INDEX: 대범주 카테고리별 핀 개수
 */

function getRecentlyViewed() {
    try {
        return JSON.parse(localStorage.getItem('recentlyViewedPins') || '[]');
    } catch (err) {
        return [];
    }
}

// 커서의 현재 화면 좌표를 항상 최신으로 들고 있는다. 마퀴 카드는 CSS 애니메이션으로
// 계속 옆으로 흘러가기 때문에, 커서가 가만히 있는데 카드만 그 밑을 빠져나가면
// 브라우저가 mouseleave를 안 쏴줄 때가 있다 - 그러면 회전이 영원히 안 멈추는 버그가 된다.
// 그래서 각 카드가 매 프레임 스스로 "커서가 아직 내 위에 있나"를 직접 확인한다.
let cursorX = -9999;
let cursorY = -9999;
document.addEventListener('mousemove', (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
});

/**
 * 이미지 자체를 커서가 올라와 있는 동안 계속 360도로 회전시키고, 커서가 빠지면
 * 지금 각도에서 가장 가까운 다음 정면(360도 배수)까지 감속하며 자연스럽게 멈춘다.
 * (CSS 애니메이션으로는 멈출 때 각도가 뚝 끊겨 보여서, 매 프레임 각도를 직접 계산한다)
 */
function attachSpinHover(card, img) {
    const MAX_SPEED = 2.0; // 호버 중 최고 속도(프레임당 회전량, 도) - 한 바퀴에 약 3초
    const ACCEL = 0.028; // 회전 속도가 목표 속도로 다가가는 비율 (작을수록 천천히 부드럽게 가속)
    let angle = 0;
    let speed = 0;
    let hovering = false;
    let rafId = null;

    function isCursorOverCard() {
        const rect = card.getBoundingClientRect();
        return cursorX >= rect.left && cursorX <= rect.right && cursorY >= rect.top && cursorY <= rect.bottom;
    }

    // scale(1.1)은 CSS 쪽과 마찬가지로 핀 이미지에 캡처되어 있는 핀터레스트 자체
    // 둥근 모서리를 화면 밖으로 밀어내기 위한 것 - 회전 각도만 바뀌어도 이 값은 항상 유지해야 한다
    function setAngle(deg) {
        img.style.transform = `perspective(900px) scale(1.1) rotateY(${deg}deg)`;
    }

    function frame() {
        // 실제 mouseleave 이벤트가 씹혀도(카드가 흘러가서 커서 밑을 빠져나간 경우)
        // 매 프레임 위치를 직접 재확인해서 스스로 바로잡는다
        if (hovering && !isCursorOverCard()) {
            hovering = false;
        }

        if (hovering) {
            speed += (MAX_SPEED - speed) * ACCEL; // 서서히 가속하며 부드럽게 돌기 시작
            angle += speed;
            setAngle(angle);
            rafId = requestAnimationFrame(frame);
            return;
        }

        // 정지 단계: 가장 가까운 정면(다음 360도 배수)까지 남은 거리에 비례해서
        // 점점 느려지며 다가가다가, 충분히 가까워지면 정확히 0도로 스냅한다
        const target = Math.ceil(angle / 360) * 360;
        const remaining = target - angle;
        if (remaining < 0.5) {
            angle = 0;
            setAngle(0);
            rafId = null;
            return;
        }
        speed = Math.max(remaining * 0.03, 0.3);
        angle += speed;
        setAngle(angle);
        rafId = requestAnimationFrame(frame);
    }

    return {
        start() {
            hovering = true;
            if (!rafId) rafId = requestAnimationFrame(frame);
        },
        stop() {
            hovering = false;
            if (!rafId) rafId = requestAnimationFrame(frame);
        }
    };
}

/**
 * 마퀴 카드 하나를 만든다. 프레임 없이 이미지 자체만 있고, 카드 전체가
 * 그 핀의 상세 페이지로 가는 링크다. 호버하면 이미지가 계속 회전한다.
 */
function createMarqueeCard(pin) {
    const card = document.createElement('a');
    card.className = 'marquee-card';
    card.href = `gallery.html?pin=${encodeURIComponent(pin.id)}`;

    const img = document.createElement('img');
    img.className = 'marquee-card-img';
    img.src = pin.image;
    img.alt = '';
    img.loading = 'lazy';
    card.appendChild(img);

    const spin = attachSpinHover(card, img);
    card.addEventListener('mouseenter', () => spin.start());
    card.addEventListener('mouseleave', () => spin.stop());

    return card;
}

async function initMarquee() {
    const track = document.getElementById('marquee-track');
    const pinCountEl = document.getElementById('pin-count');
    const dateEl = document.getElementById('banner-date');

    const today = new Date();
    dateEl.textContent = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

    try {
        const res = await fetch('/api/pins');
        const data = await res.json();
        const pins = (data.pins || []).filter((p) => p.image && p.image.startsWith('/images/'));

        pinCountEl.textContent = `${data.total || pins.length} pins`;

        // 이 브라우저에서 최근에 자세히 본 이미지를 앞쪽에 우선 배치하고,
        // 나머지는 무작위 샘플로 채운다
        const recentlyViewed = getRecentlyViewed().filter((p) => p.image);
        const recentIds = new Set(recentlyViewed.map((p) => p.id));
        const rest = pins.filter((p) => !recentIds.has(p.id));
        const picked = [...recentlyViewed, ...rest].slice(0, 28);

        if (picked.length === 0) {
            track.remove();
            return [];
        }

        // 이어지는 느낌을 위해 목록을 두 번 반복해서 넣고, CSS가 -50%까지 이동시키면
        // 끊김 없이 처음으로 되돌아간 것처럼 보인다
        const renderSet = () => {
            picked.forEach((pin) => {
                track.appendChild(createMarqueeCard(pin));
            });
        };
        renderSet();
        renderSet();

        return pins;
    } catch (err) {
        console.warn('핀 데이터를 불러오지 못했습니다:', err);
        pinCountEl.textContent = '';
        return [];
    }
}

async function initArchiveIndex() {
    const listEl = document.getElementById('index-list');

    try {
        const res = await fetch('/api/categories');
        const data = await res.json();
        const categories = (data.categories || []).slice(0, 10);

        listEl.innerHTML = '';

        categories.forEach((cat, i) => {
            // 인덱스에서 바로 터널로 들어가 그 카테고리가 검색된 채로 열리는 바로가기
            const row = document.createElement('a');
            row.className = 'index-row';
            row.href = `gallery.html?q=${encodeURIComponent(cat.name)}`;
            row.innerHTML = `
                <span class="index-num">${String(i + 1).padStart(2, '0')}</span>
                <span class="index-name">${cat.name}</span>
                <span class="index-count">${String(cat.count).padStart(3, '0')}</span>
            `;
            listEl.appendChild(row);
        });
    } catch (err) {
        console.warn('카테고리 데이터를 불러오지 못했습니다:', err);
    }
}

(async function initLanding() {
    await Promise.all([initMarquee(), initArchiveIndex()]);
})();
