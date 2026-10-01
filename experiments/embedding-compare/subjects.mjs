/**
 * "무엇이 찍혀 있나" 주제 분류. 주관이 아니라 객관적인 내용이라 라벨 없이 이미지 모델만으로 판별한다.
 *
 * 사진 한 장마다 아래 CATEGORIES 중 무엇인지 후보끼리 경쟁시켜 확률을 낸다 (절대평가).
 * 다른 핀과 비교하는 상대평가는, 아카이브에 음식 사진이 없어도 "가장 음식 같은 사진"을 억지로 뽑아서 쓰지 않는다.
 * 주제(SUBJECTS)는 카테고리 확률의 합이다. 예: 옷 = 패션 사진 + 옷 단품 사진.
 * threshold: 이 확률 이상이면 그 주제가 있는 사진으로 본다 (build-subjects.mjs의 확률대별 이미지를 눈으로 보고 정함)
 */
export const CATEGORIES = {
    fashion_photo: ['a street style photo of a person wearing an outfit', 'a fashion lookbook photo of a model', 'people standing on the street in casual clothes'],
    portrait: ['a close-up portrait of a human face', 'a selfie of a person'],
    clothing_item: ['a product photo of a single clothing item', 'a jacket, sweater or shoes on a plain background', 'a bag or accessory product shot'],
    food: ['a photo of food on a plate', 'a bowl of soup or noodles', 'dessert, cake or drinks on a table'],
    screenshot: ['a phone screenshot of a social media post with text', 'a screenshot of a chat or article', 'a meme image with korean captions'],
    architecture: ['a photo of a building exterior', 'architecture photography of a structure', 'a city street with buildings'],
    interior: ['an interior room with furniture', 'a gallery or exhibition space', 'a living room or shop interior'],
    render3d: ['a 3d rendered object with glossy cgi lighting', 'computer generated 3d graphics', 'a blender 3d scene'],
    poster: ['a graphic design poster with typography', 'experimental lettering and type design', 'an editorial book layout with text'],
    // 아래는 주제로 쓰지 않지만, 경쟁 후보로 있어야 위 주제들이 억지로 뽑히지 않는다
    abstract: ['an abstract texture or pattern', 'abstract generative art', 'a glitch art image'],
    illustration: ['a hand drawn illustration', 'a cartoon or comic drawing', 'a painting on canvas'],
    object: ['a product photo of an object or sculpture', 'a craft object on a plain background', 'a vehicle or machine'],
    nature: ['a landscape photo of nature', 'plants, flowers and trees', 'an animal photo']
};

export const SUBJECTS = [
    { id: 'person', ko: '사람', threshold: 0.7, categories: ['fashion_photo', 'portrait'],
        synonyms: ['사람', '인물', '얼굴', '포트레이트', '셀카'] },
    { id: 'clothing', ko: '옷', threshold: 0.5, categories: ['fashion_photo', 'clothing_item'],
        synonyms: ['옷', '패션', '의류', '코디', '룩북', '스트릿', '착장'] },
    { id: 'food', ko: '음식', threshold: 0.5, categories: ['food'],
        synonyms: ['음식', '요리', '먹을', '디저트', '푸드'] },
    { id: 'screenshot', ko: '스크린샷·글', threshold: 0.5, categories: ['screenshot'],
        synonyms: ['스크린샷', '캡처', '캡쳐', '텍스트', '짤', '밈'] },
    { id: 'architecture', ko: '건축·인테리어', threshold: 0.5, categories: ['architecture', 'interior'],
        synonyms: ['건축', '건물', '인테리어', '실내', '가구', '공간 디자인'] },
    { id: 'render3d', ko: '3D 렌더', threshold: 0.5, categories: ['render3d'],
        synonyms: ['3d 렌더', '3d렌더', '렌더링', '렌더', 'cg', '블렌더', '시포디'] },
    { id: 'poster', ko: '포스터·타이포', threshold: 0.5, categories: ['poster'],
        synonyms: ['포스터', '타이포', '레터링', '폰트', '글씨', '서체', '편집 디자인'] }
];


// 주제어 뒤에 붙을 수 있는 조사 ("옷이", "사람들을", "포스터인데") - "옷장"처럼 다른 낱말이 되는 건 제외
const PARTICLE = '(?:들)?(?:이랑|인데|이고|이나|에서|으로|처럼|이|가|을|를|은|는|의|도|만|랑|과|와|에|로)?';
// "사람 없는", "옷 빼고", "음식 사진 말고"
const NEGATION = '(?:\\s*(?:사진|이미지|그림))?\\s*(?:이?\\s*없는|없이|빼고|제외|말고|아닌)';

/**
 * 검색어에서 주제어를 찾는다. "옷" → include, "사람 없는" / "옷 빼고" → exclude.
 * 찾은 주제어는 지워서 rest로 돌려준다 (나머지는 느낌 키워드 파싱으로 넘긴다).
 */
export function parseSubjects(text) {
    let rest = text.toLowerCase();
    const include = [], exclude = [];
    const entries = SUBJECTS.flatMap((s) => s.synonyms.map((syn) => [syn.toLowerCase(), s.id]))
        .sort((a, b) => b[0].length - a[0].length);
    for (const [syn, id] of entries) {
        const word = `(^|[^\\p{L}\\p{N}])${syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
        const negated = new RegExp(`${word}${PARTICLE}${NEGATION}`, 'u');
        const plain = new RegExp(`${word}${PARTICLE}(?=$|[^\\p{L}\\p{N}])`, 'u');
        if (negated.test(rest)) {
            if (!exclude.includes(id)) exclude.push(id);
            rest = rest.replace(new RegExp(negated.source, 'gu'), '$1 ');
        } else if (plain.test(rest)) {
            if (!include.includes(id)) include.push(id);
            rest = rest.replace(new RegExp(plain.source, 'gu'), '$1 ');
        }
    }
    return { include, exclude, rest };
}
