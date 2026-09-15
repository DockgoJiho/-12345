/**
 * 대범주(카테고리) 표준 사전.
 * 각 카테고리는 하나의 canonical key를 갖고, 한국어/영어 라벨과 여러 동의어를 갖는다.
 * 검색 시 "그래픽 아트"와 "Graphic Art"처럼 언어가 섞여 들어와도
 * 동의어 정규화를 거쳐 같은 key로 인식되도록 한다.
 */
const CATEGORY_TAXONOMY = [
    {
        key: 'photography',
        en: 'Photography',
        ko: '사진',
        synonyms: ['photo', 'photograph', 'photography', 'snapshot', '사진', '포토', '스냅']
    },
    {
        key: 'graphic_design',
        en: 'Graphic Design',
        ko: '그래픽 디자인',
        synonyms: [
            'graphic design', 'graphic art', 'graphicdesign', 'graphicart', 'poster', 'layout',
            '그래픽디자인', '그래픽 디자인', '그래픽아트', '그래픽 아트', '그래픽', '포스터', '레이아웃'
        ]
    },
    {
        key: 'illustration',
        en: 'Illustration',
        ko: '일러스트레이션',
        synonyms: ['illustration', 'illust', 'drawing', '일러스트레이션', '일러스트', '그림']
    },
    {
        key: 'typography',
        en: 'Typography',
        ko: '타이포그래피',
        synonyms: ['typography', 'lettering', 'type design', '타이포그래피', '타이포', '레터링', '폰트']
    },
    {
        key: '3d',
        en: '3D',
        ko: '3D',
        synonyms: ['3d', '3d art', '3d design', 'cgi', 'render', 'sculpture', '3디', '삼디', '조각', '피규어', '오브제', '렌더']
    },
    {
        key: 'fashion',
        en: 'Fashion',
        ko: '패션',
        synonyms: ['fashion', 'style', 'outfit', 'runway', '패션', '스타일', '런웨이']
    },
    {
        key: 'architecture',
        en: 'Architecture',
        ko: '건축',
        synonyms: ['architecture', 'building', '건축', '건물']
    },
    {
        key: 'interior',
        en: 'Interior',
        ko: '인테리어',
        synonyms: ['interior', 'room', '인테리어', '실내']
    },
    {
        key: 'textile_craft',
        en: 'Textile & Craft',
        ko: '텍스타일/공예',
        synonyms: [
            'textile', 'textile craft', 'embroidery', 'craft', 'weaving', 'quilting',
            '텍스타일', '텍스타일공예', '텍스타일 공예', '자수', '공예', '직조', '퀼팅'
        ]
    },
    {
        key: 'abstract',
        en: 'Abstract',
        ko: '추상',
        synonyms: ['abstract', 'pattern', 'texture', '추상', '패턴', '텍스처']
    },
    {
        key: 'fine_art',
        en: 'Fine Art',
        ko: '순수 미술',
        synonyms: ['fine art', 'painting', 'collage', 'art', '순수미술', '순수 미술', '회화', '콜라주', '미술', '아트']
    },
    {
        key: 'nature',
        en: 'Nature',
        ko: '자연',
        synonyms: ['nature', 'landscape', 'plant', '자연', '풍경', '식물']
    }
];

function getCategoryByKey(key) {
    return CATEGORY_TAXONOMY.find((c) => c.key === key) || null;
}

module.exports = { CATEGORY_TAXONOMY, getCategoryByKey };
