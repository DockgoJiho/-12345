/**
 * 실험용 검색어. expansions는 실제 서비스에서 LLM이 생성할 부분을 손으로 쓴 것이다.
 * 장르명 대신 질감, 재료, 기법, 레이아웃, 빛처럼 눈에 보이는 형식 요소로만 묘사한다.
 */
export const QUERIES = [
    {
        ko: '차가운데 손맛 있는', en: 'cold but with a handmade touch',
        expansions: [
            'cool grey and pale blue tones with visible hand-made texture',
            'white plaster relief sculpted by hand',
            'embossed white paper with subtle shadows',
            'muted cold colors with rough brush strokes',
            'minimal monochrome craft object with handmade imperfections'
        ]
    },
    {
        ko: '망가진 타이포인데 정돈된 느낌', en: 'broken typography that still feels orderly',
        expansions: [
            'distorted fragmented letters arranged on a strict grid',
            'experimental deconstructed typeface specimen with clean layout',
            'glitched cut-up lettering in a disciplined typographic poster',
            'stretched and broken letterforms aligned in neat columns',
            'black and white experimental typography with systematic composition'
        ]
    },
    {
        ko: '반투명 레이어가 겹친 격자', en: 'grid of overlapping translucent layers',
        expansions: [
            'overlapping semi-transparent colored rectangles on a grid',
            'layered translucent sheets creating color blending',
            'transparent glass panels stacked in a grid structure',
            'grid pattern seen through frosted translucent layers',
            'overprint transparency with overlapping shapes'
        ]
    },
    {
        ko: '저해상도 디더링', en: 'low resolution dithering',
        expansions: [
            'dithered image made of black and white dots',
            'halftone dot pattern with visible pixels',
            'low resolution pixelated bitmap graphic',
            'one-bit dithering gradient texture',
            'coarse pixel grid with noise pattern'
        ]
    },
    {
        ko: '여백이 많은 미니멀한 포스터', en: 'minimal poster with lots of empty space',
        expansions: [
            'poster with a small element and vast empty white space',
            'minimal layout with tiny text in the corner',
            'sparse composition with large blank background',
            'simple poster with one small shape centered on plain background',
            'quiet minimal graphic design with generous margins'
        ]
    },
    {
        ko: '조용한데 긴장감 있는', en: 'quiet but tense',
        expansions: [
            'still minimal composition with a sharp off-balance element',
            'calm muted image with a single thin line creating tension',
            'empty space with an object placed precariously at the edge',
            'monochrome photograph with dramatic shadow and silence',
            'restrained layout with a tight asymmetric focal point'
        ]
    },
    {
        ko: '촌스러운데 세련된', en: 'kitschy yet sophisticated',
        expansions: [
            'retro kitsch colors arranged in a refined contemporary layout',
            'vernacular old-fashioned graphics reinterpreted with modern design',
            'loud clashing colors and clip-art used in a stylish way',
            'nostalgic tacky ornaments in an elegant composition',
            'gaudy saturated pink and green with clean typography'
        ]
    },
    {
        ko: '디지털인데 유기적인', en: 'digital but organic',
        expansions: [
            'computer generated forms that look like living organisms',
            'smooth 3D rendered biomorphic shapes',
            'generative art with flowing natural patterns',
            'digital texture resembling cells, coral, or plants',
            'chrome blob shapes melting like liquid'
        ]
    },
    {
        ko: '무겁고 축축한 느낌', en: 'heavy and damp feeling',
        expansions: [
            'dark wet surfaces with dense heavy texture',
            'murky moody photograph with moisture and fog',
            'thick dark mud-like material with glossy wetness',
            'heavy dark tones with water stains and damp textures',
            'gloomy rainy atmosphere in deep green and black'
        ]
    }
];
