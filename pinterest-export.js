/**
 * Pinterest "데이터 요청"으로 받은 내보내기(ZIP 안의 pins/0001.html, 0002.html ...)에서 핀 목록을 읽는다.
 * 브라우저(가져오기 창)와 Node(테스트)에서 같이 쓴다.
 *
 * 내보내기에는 이미지 주소가 없고 "Image: 5aaf3193..." 같은 해시만 있다. Pinterest 이미지 주소는
 * i.pinimg.com/<크기>/<해시 앞 2글자>/<다음 2글자>/<다음 2글자>/<해시>.jpg 꼴이라 해시만으로 만들 수 있다.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PinterestExport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const PIN_START = /<a href="https:\/\/www\.pinterest\.com\/pin\/(\d+)\/?">/g;
    const FIELD_NAMES = ['Title', 'Details', 'Image', 'Board Name', 'Alive', 'Canonical Link', 'Is Video', 'Created at'];

    const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    function decodeEntities(text) {
        return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
            if (code[0] === '#') {
                const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
                return Number.isFinite(n) ? String.fromCodePoint(n) : m;
            }
            return ENTITIES[code.toLowerCase()] ?? m;
        });
    }

    const clean = (value) => {
        const text = decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
        return text === 'No data' ? '' : text;
    };

    function imageUrlFromHash(hash, size = '736x') {
        if (!/^[0-9a-f]{32}$/i.test(hash)) return '';
        const h = hash.toLowerCase();
        return `https://i.pinimg.com/${size}/${h.slice(0, 2)}/${h.slice(2, 4)}/${h.slice(4, 6)}/${h}.jpg`;
    }

    /** 내보내기 HTML 한 장(0001.html 등)에서 핀들을 읽는다 */
    function parsePinsPage(html) {
        const starts = [];
        let m;
        PIN_START.lastIndex = 0;
        while ((m = PIN_START.exec(html))) starts.push({ id: m[1], at: m.index, bodyAt: PIN_START.lastIndex });

        return starts.map((start, i) => {
            const block = html.slice(start.bodyAt, i + 1 < starts.length ? starts[i + 1].at : html.length);
            // 각 줄은 "이름: 값 <br>" 꼴이다. 값 안에 링크(<a>)가 들어 있기도 하다
            const fields = {};
            block.split(/<br\s*\/?>/i).forEach((line) => {
                const text = line.replace(/^\s+/, '');
                for (const name of FIELD_NAMES) {
                    if (text.startsWith(`${name}:`)) {
                        fields[name] = clean(text.slice(name.length + 1));
                        break;
                    }
                }
            });
            return { id: start.id, ...fields };
        });
    }

    /**
     * 읽은 핀들을 사이트에 저장할 모양으로 바꾼다. 지워진 핀(Alive: No), 이미지가 없는 핀은 뺀다.
     * 같은 핀이 여러 페이지에 나오면 하나만 남긴다.
     */
    function toImportPins(rawPins) {
        const seen = new Set();
        const pins = [];
        rawPins.forEach((p) => {
            if (seen.has(p.id)) return;
            if (p.Alive && p.Alive.toLowerCase() === 'no') return;
            const image = imageUrlFromHash(p.Image || '');
            if (!image) return;
            seen.add(p.id);
            pins.push({
                id: p.id,
                title: p.Title || '',
                description: p.Details || '',
                image,
                link: `https://www.pinterest.com/pin/${p.id}/`,
                creator: p['Board Name'] || '',
                sourceLink: p['Canonical Link'] || ''
            });
        });
        return pins;
    }

    /** 파일 이름이 내보내기의 핀 목록 페이지인지 (pins/0001.html 같은 것) */
    const isPinsPage = (name) => /(^|\/)pins\/\d+\.html$/i.test(name) || /^\d{4}\.html$/i.test(name.split('/').pop());

    return { parsePinsPage, toImportPins, imageUrlFromHash, isPinsPage };
});
