import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// AI가 만든 새 키워드, AI가 기존 키워드에 연결해 준 새 표현 (keyword-ai.mjs가 기록)
const CUSTOM_FILE = path.join(HERE, 'custom_keywords.json');
const LEARNED_FILE = path.join(HERE, 'learned_synonyms.json');

/**
 * 주관 키워드 사전.
 * - group: 'extra'면 사용자가 처음 정한 25개 외에 추가한 키워드 (없으면 사용자 키워드)
 * - synonyms: 사용자가 이 중 아무 말이나 쓰면 같은 키워드로 본다 (토씨가 달라도 같은 의미면 매칭)
 * - expansions: 라벨이 하나도 없을 때 AI가 처음 점수를 매기는 데 쓰는 영어 시각 묘사.
 *   라벨이 쌓이면 사용자의 "맞아/아니야" 예시가 이 출발점을 사용자 감각 쪽으로 끌어당긴다.
 */
export const KEYWORDS = [
    { id: 'cold', ko: '차가운',
        synonyms: ['차가운', '차갑', '차가움', '쿨톤', '냉한', '냉랭', '서늘', '시린'],
        expansions: ['cold blue and grey color palette', 'icy sterile clinical atmosphere', 'cool metallic and glass surfaces', 'detached emotionless minimal mood', 'pale cold light'] },
    { id: 'glitch', ko: '글리치',
        synonyms: ['글리치', '노이즈', '깨진 화면', '디지털 오류', '오류', '버그', '데이터모싱'],
        expansions: ['digital glitch art with corrupted pixels', 'rgb channel shift and scan lines', 'datamoshing distortion', 'broken screen noise artifacts', 'pixel sorting effect'] },
    { id: 'graphic', ko: '그래픽',
        synonyms: ['그래픽', '그래피컬', '평면적'],
        expansions: ['bold flat graphic design', 'poster with strong shapes and typography', 'vector illustration with solid colors', 'graphic composition with clear contrast'] },
    { id: 'dense', ko: '밀도 높은',
        synonyms: ['밀도가 있', '밀도 있', '밀도가 높', '밀도 높', '고밀도', '빽빽', '꽉 찬', '꽉찬', '촘촘', '가득 찬', '오밀조밀', '빼곡'],
        expansions: ['densely packed composition filling the whole frame', 'crowded with many small elements', 'intricate detailed pattern with no empty space', 'busy layout full of information'] },
    { id: 'sparse', ko: '여백 많은',
        synonyms: ['여백', '밀도가 낮', '밀도 낮', '저밀도', '비어 있', '비어있', '텅 빈', '한산', '미니멀'],
        expansions: ['lots of empty negative space', 'sparse minimal composition', 'small element on a large blank background', 'airy layout with generous margins'] },
    { id: 'chaotic', ko: '혼란스러운',
        synonyms: ['혼란', '혼돈', '어지러', '난잡', '정신없', '정신 없', '카오스', '산만'],
        expansions: ['chaotic messy composition', 'random scattered elements colliding', 'disorder and visual noise', 'overwhelming clutter with no hierarchy'] },
    { id: 'orderly', ko: '정돈된',
        synonyms: ['정돈', '정리된', '깔끔', '질서', '체계적', '그리드', '반듯'],
        expansions: ['neatly organized grid layout', 'clean orderly alignment', 'systematic structured composition', 'tidy arrangement with consistent spacing'] },
    { id: 'layered', ko: '레이어가 많은',
        synonyms: ['레이어', '겹친', '겹쳐', '겹겹', '중첩', '오버랩'],
        expansions: ['many overlapping layers', 'stacked transparent and opaque layers', 'collage of superimposed images', 'depth created by overlapping elements'] },
    { id: 'warm', ko: '따뜻한',
        synonyms: ['따뜻', '따듯', '따스', '온기', '웜톤'],
        expansions: ['warm color palette of orange red and yellow', 'soft golden sunlight', 'warm cozy tones', 'amber glow'] },
    { id: 'cozy', ko: '포근한',
        synonyms: ['포근', '아늑', '폭신', '보들', '푹신'],
        expansions: ['soft fluffy textures like wool and blankets', 'cozy intimate interior', 'plush gentle tactile materials', 'soft knitted fabric'] },
    { id: 'comfortable', ko: '편한 느낌',
        synonyms: ['편한', '편안', '편함', '여유', '차분', '릴랙스', '느긋'],
        expansions: ['relaxed calm easygoing atmosphere', 'casual comfortable everyday scene', 'peaceful gentle mood', 'laid-back natural setting'] },
    { id: 'pretty', ko: '이쁜',
        synonyms: ['이쁜', '예쁜', '이쁘', '예쁘', '사랑스러', '아름다', '러블리'],
        expansions: ['pretty delicate and charming', 'lovely pastel aesthetic', 'beautiful pleasing harmonious image', 'sweet graceful details'] },
    { id: 'cool', ko: '멋있는',
        synonyms: ['멋있', '멋진', '간지', '힙한', '힙하', '세련', '쿨한'],
        expansions: ['cool stylish edgy image', 'striking bold and confident visual', 'sleek sophisticated design', 'impressive dramatic aesthetic'] },
    { id: 'dimensional', ko: '입체적인',
        synonyms: ['입체', '3d', '볼륨감', '깊이감', '공간감'],
        expansions: ['three-dimensional object with strong volume', '3d rendered form with depth and shadows', 'sculptural relief with depth', 'perspective and spatial depth'] },
    { id: 'tactile', ko: '물성 있는',
        synonyms: ['물성', '질감', '텍스처', '텍스쳐', '재질감', '촉감', '촉각'],
        expansions: ['strong material texture you can almost touch', 'tactile physical surface like paper, clay, fabric or metal', 'close-up of rough material grain', 'handmade physical object with texture'] },
    { id: 'shiny', ko: '반짝이는',
        synonyms: ['반짝', '광택', '빛나', '글리터', '크롬', '홀로그램', '번쩍'],
        expansions: ['shiny glossy reflective surface', 'sparkling glitter and light reflections', 'chrome metallic shine', 'iridescent holographic gleam'] },
    { id: 'unusual_layout', ko: '특이한 배치',
        synonyms: ['특이한 배치', '독특한 배치', '이상한 배치', '특이한 구도', '독특한 구도', '파격', '특이한 레이아웃', '독특한 레이아웃'],
        expansions: ['unconventional asymmetric layout', 'elements placed in unexpected positions', 'rotated tilted text and images breaking the grid', 'unusual cropping and composition'] },
    { id: 'experimental', ko: '실험적인',
        synonyms: ['실험', '아방가르드', '전위', '낯선'],
        expansions: ['experimental avant-garde visual art', 'unconventional techniques and processes', 'abstract boundary-pushing design', 'strange new visual language'] },
    { id: 'eye_straining', ko: '눈 아픈',
        synonyms: ['눈 아픈', '눈아픈', '눈이 아픈', '쨍한', '쨍하', '형광', '현란', '눈부신'],
        expansions: ['eye-straining vivid neon colors', 'harsh high-contrast clashing colors', 'dizzying optical pattern', 'intense saturated fluorescent palette'] },
    { id: 'smooth', ko: '매끈한',
        synonyms: ['매끈', '매끄러', '반들', '미끈', '매끈매끈'],
        expansions: ['smooth seamless polished surface', 'sleek glossy render without texture', 'soft gradient on a flawless surface', 'clean frictionless material'] },
    { id: 'round', ko: '둥근',
        synonyms: ['둥근', '둥글', '동그란', '동글', '곡선', '라운드'],
        expansions: ['rounded soft curvy shapes', 'circles and smooth curves', 'bubbly blob forms', 'organic rounded edges'] },
    { id: 'futuristic', ko: '미래적인',
        synonyms: ['미래', 'sf', '사이버', '하이테크', '테크'],
        expansions: ['futuristic sci-fi aesthetic', 'high-tech digital interface', 'cyber chrome future design', 'space age technology'] },
    { id: 'retro', ko: '레트로한',
        synonyms: ['레트로', '복고', '빈티지', '옛날', '올드'],
        expansions: ['retro vintage design from the 70s or 80s', 'nostalgic old printed matter', 'faded vintage photograph', 'old-fashioned typography and colors'] },
    { id: 'classic', ko: '정통적인',
        synonyms: ['정통', '클래식', '전통', '고전'],
        expansions: ['classic traditional design', 'timeless conventional layout', 'classical art and serif typography', 'traditional craftsmanship and heritage style'] },
    { id: 'refreshing', ko: '시원한',
        synonyms: ['시원', '청량', '상쾌', '개운'],
        expansions: ['refreshing cool blue and aqua tones', 'clear water and sky', 'crisp fresh airy feeling', 'light breezy summer mood'] },
    // ── 여기부터 추가 키워드 (사람들이 레퍼런스를 찾을 때 자주 쓰는 주관적인 말) ──

    // 감정 · 분위기
    { id: 'handmade', ko: '손맛 있는', group: 'extra',
        synonyms: ['손맛', '수작업', '핸드메이드', '손으로 만든', '수공예', '손그림', '손글씨'],
        expansions: ['handmade craft with visible human touch', 'hand-drawn illustration with imperfect lines', 'hand-cut paper and manual printing', 'handcrafted object with small irregularities'] },
    { id: 'dreamy', ko: '몽환적인', group: 'extra',
        synonyms: ['몽환', '꿈같', '꿈 같', '드리미', '몽글', '몽롱', '아련'],
        expansions: ['dreamy hazy soft focus atmosphere', 'ethereal pastel glow and mist', 'surreal floating dreamlike scene', 'soft blurred light like a memory'] },
    { id: 'dark', ko: '어두운', group: 'extra',
        synonyms: ['어두운', '어둡', '음울', '우울', '다크', '침울', '음산'],
        expansions: ['dark moody low-key image', 'gloomy shadowy atmosphere', 'deep black tones with little light', 'melancholic somber mood'] },
    { id: 'bright', ko: '밝은', group: 'extra',
        synonyms: ['밝은', '밝고', '화사', '경쾌', '쾌활', '명랑', '발랄'],
        expansions: ['bright cheerful high-key image', 'light airy and joyful colors', 'sunny upbeat atmosphere', 'lively vibrant happy mood'] },
    { id: 'lonely', ko: '쓸쓸한', group: 'extra',
        synonyms: ['쓸쓸', '외로', '고독', '공허', '멜랑꼴리', '멜랑콜리', '허전'],
        expansions: ['lonely solitary figure in empty space', 'melancholic quiet desolate scene', 'isolated object in a vast void', 'nostalgic wistful emptiness'] },
    { id: 'serene', ko: '고요한', group: 'extra',
        synonyms: ['고요', '잔잔', '적막', '조용', '평온', '정적이'],
        expansions: ['serene still and silent scene', 'calm quiet composition with soft light', 'peaceful stillness with nothing moving', 'tranquil muted atmosphere'] },
    { id: 'tense', ko: '긴장감 있는', group: 'extra',
        synonyms: ['긴장', '불안', '위태', '아슬', '팽팽', '서스펜스'],
        expansions: ['tense unsettling composition', 'precarious balance about to fall', 'sharp contrast creating suspense', 'anxious claustrophobic atmosphere'] },
    { id: 'cute', ko: '귀여운', group: 'extra',
        synonyms: ['귀여', '귀엽', '큐트', '깜찍', '앙증'],
        expansions: ['cute adorable character', 'kawaii playful rounded illustration', 'small charming toy-like objects', 'sweet childlike pastel design'] },
    { id: 'grotesque', ko: '기괴한', group: 'extra',
        synonyms: ['기괴', '그로테스크', '괴상', '기묘', '언캐니', '징그', '섬뜩'],
        expansions: ['grotesque distorted bodies', 'uncanny disturbing strange imagery', 'creepy surreal mutated forms', 'bizarre unsettling horror aesthetic'] },
    { id: 'mysterious', ko: '신비로운', group: 'extra',
        synonyms: ['신비', '미스터리', '미스테리', '오묘', '수수께끼'],
        expansions: ['mysterious enigmatic atmosphere', 'mystical glowing light in darkness', 'hidden secret symbols and shadows', 'otherworldly magical scene'] },
    { id: 'epic', ko: '웅장한', group: 'extra',
        synonyms: ['웅장', '장엄', '거대한', '압도', '스케일 큰', '스펙타클'],
        expansions: ['epic grand monumental scale', 'massive structure towering over tiny people', 'majestic dramatic landscape', 'overwhelming awe-inspiring composition'] },
    { id: 'witty', ko: '위트 있는', group: 'extra',
        synonyms: ['위트', '유쾌', '재치', '장난', '유머', '익살', '재밌', '재미있'],
        expansions: ['witty playful visual joke', 'humorous unexpected combination', 'fun quirky illustration', 'clever ironic design with a twist'] },
    { id: 'elegant', ko: '우아한', group: 'extra',
        synonyms: ['우아', '기품', '단아', '엘레강스', '엘레간트'],
        expansions: ['elegant graceful refined composition', 'delicate thin serif typography with poise', 'graceful flowing lines', 'sophisticated understated beauty'] },
    { id: 'luxurious', ko: '고급스러운', group: 'extra',
        synonyms: ['고급', '럭셔리', '프리미엄', '하이엔드', '값비싼'],
        expansions: ['luxurious premium high-end aesthetic', 'gold marble and velvet materials', 'luxury fashion editorial', 'expensive polished minimal product'] },
    { id: 'kitsch', ko: '키치한', group: 'extra',
        synonyms: ['키치', 'b급', '촌스러', '촌스럽', '싸구려', '조잡', '저렴해 보'],
        expansions: ['kitsch tacky colorful aesthetic', 'cheap vernacular graphics and clip art', 'gaudy over-the-top decoration', 'campy lowbrow pop culture imagery'] },
    { id: 'decadent', ko: '퇴폐적인', group: 'extra',
        synonyms: ['퇴폐', '데카당', '관능', '나른'],
        expansions: ['decadent sensual moody atmosphere', 'languid dark romantic scene', 'smoky dim light with rich deep colors', 'seductive melancholic glamour'] },
    { id: 'lyrical', ko: '서정적인', group: 'extra',
        synonyms: ['서정', '시적', '포에틱', '감성적'],
        expansions: ['poetic lyrical gentle image', 'soft nostalgic light and quiet emotion', 'delicate scene with sentimental mood', 'tender atmospheric photograph'] },
    { id: 'psychedelic', ko: '사이키델릭한', group: 'extra',
        synonyms: ['사이키', '환각', '트리피', '사이키델릭'],
        expansions: ['psychedelic swirling saturated colors', 'trippy hallucinatory patterns', 'melting kaleidoscopic forms', 'acid rainbow distortion'] },
    { id: 'intense', ko: '강렬한', group: 'extra',
        synonyms: ['강렬', '임팩트', '파워풀', '세다', '센 느낌'],
        expansions: ['intense powerful bold image', 'striking high impact visual', 'aggressive strong colors and shapes', 'loud dramatic composition'] },
    { id: 'subtle', ko: '은은한', group: 'extra',
        synonyms: ['은은', '절제', '담백', '수수', '슴슴'],
        expansions: ['subtle understated quiet design', 'restrained muted tones', 'soft gentle low contrast', 'minimal refined with delicate details'] },

    // 질감 · 형태
    { id: 'raw', ko: '날것의', group: 'extra',
        synonyms: ['날것', '날 것', '투박', '러프', '거친', '거칠', '로파이', '로우파이'],
        expansions: ['raw rough unpolished aesthetic', 'gritty lo-fi texture', 'crude handmade marks and scratches', 'unrefined brutal honest materials'] },
    { id: 'delicate', ko: '섬세한', group: 'extra',
        synonyms: ['섬세', '정교', '디테일', '세밀', '정밀', '세심'],
        expansions: ['delicate intricate fine details', 'precise thin lines and careful craftsmanship', 'detailed ornate pattern', 'fine meticulous work'] },
    { id: 'soft', ko: '부드러운', group: 'extra',
        synonyms: ['부드러', '부드럽', '소프트', '말랑', '물렁'],
        expansions: ['soft gentle forms and gradients', 'smooth pillowy squishy shapes', 'soft diffused light', 'gentle rounded tender textures'] },
    { id: 'angular', ko: '각진', group: 'extra',
        synonyms: ['각진', '각이 진', '딱딱', '날카로', '날카롭', '뾰족', '모난'],
        expansions: ['sharp angular geometric forms', 'hard edges and pointed corners', 'jagged spiky shapes', 'rigid straight-edged structure'] },
    { id: 'organic', ko: '유기적인', group: 'extra',
        synonyms: ['유기적', '오가닉', '생물', '생명체', '흐르는'],
        expansions: ['organic flowing natural forms', 'biomorphic shapes like living cells', 'irregular plant-like growth', 'fluid curving natural structures'] },
    { id: 'mechanical', ko: '기계적인', group: 'extra',
        synonyms: ['기계', '인공적', '인위적', '메카닉', '공업', '산업적', '인더스트리얼'],
        expansions: ['mechanical industrial parts and machinery', 'artificial engineered precise structure', 'metal bolts gears and pipes', 'cold technical manufactured object'] },
    { id: 'transparent', ko: '투명한', group: 'extra',
        synonyms: ['투명', '유리', '글래스', '비치는', '아크릴'],
        expansions: ['transparent glass object', 'translucent see-through layers', 'clear acrylic and refraction', 'frosted glass with light passing through'] },
    { id: 'heavy', ko: '무거운', group: 'extra',
        synonyms: ['무거운', '무겁', '묵직', '둔중', '육중'],
        expansions: ['heavy massive solid forms', 'dense dark weighty mass', 'thick bold heavy typography', 'monolithic stone or concrete block'] },
    { id: 'light_weight', ko: '가벼운', group: 'extra',
        synonyms: ['가벼운', '가볍', '라이트한', '산뜻', '경쾌한 느낌'],
        expansions: ['light airy weightless forms', 'thin delicate floating elements', 'breezy minimal fresh feeling', 'feather-like lightness'] },
    { id: 'wet', ko: '축축한', group: 'extra',
        synonyms: ['축축', '습한', '습기', '젖은', '촉촉', '물기'],
        expansions: ['wet glossy surface with water droplets', 'damp humid misty atmosphere', 'rain soaked reflections', 'moist slimy liquid texture'] },
    { id: 'dry', ko: '건조한', group: 'extra',
        synonyms: ['건조', '메마른', '드라이', '푸석'],
        expansions: ['dry dusty matte surface', 'arid cracked texture', 'dry chalky desaturated tones', 'parched desert-like atmosphere'] },

    // 색 · 톤 · 선명도
    { id: 'blurry', ko: '흐릿한', group: 'extra',
        synonyms: ['흐릿', '흐린', '블러', '뿌연', '뿌옇', '아웃포커스', '번진'],
        expansions: ['blurry out of focus image', 'motion blur and soft smudges', 'hazy foggy unclear shapes', 'diffused blurred light'] },
    { id: 'crisp', ko: '선명한', group: 'extra',
        synonyms: ['선명', '또렷', '크리스프', '샤프', '쨍하게 선명'],
        expansions: ['crisp sharp high definition image', 'clean precise edges', 'clear detailed focus', 'sharp vector clarity'] },
    { id: 'high_contrast', ko: '대비가 강한', group: 'extra',
        synonyms: ['대비가 강', '대비 강', '대비가 센', '하이콘트라스트', '콘트라스트', '명암'],
        expansions: ['high contrast black and white', 'stark light and deep shadow', 'bold contrasting colors side by side', 'dramatic chiaroscuro lighting'] },
    { id: 'muted', ko: '채도 낮은', group: 'extra',
        synonyms: ['채도 낮', '채도가 낮', '저채도', '뮤트', '물빠진', '물 빠진', '탁한', '톤다운'],
        expansions: ['muted desaturated color palette', 'dusty faded tones', 'greyish subdued colors', 'washed out low saturation'] },
    { id: 'vivid', ko: '채도 높은', group: 'extra',
        synonyms: ['채도 높', '채도가 높', '고채도', '원색', '비비드', '선명한 색'],
        expansions: ['vivid highly saturated colors', 'bold primary colors red yellow blue', 'bright intense pure hues', 'colorful vibrant palette'] },
    { id: 'pastel', ko: '파스텔', group: 'extra',
        synonyms: ['파스텔', '연한 색', '연한색', '여리여리'],
        expansions: ['soft pastel color palette', 'pale pink mint lavender tones', 'light sugary pastel colors', 'gentle powdery hues'] },
    { id: 'monochrome', ko: '흑백', group: 'extra',
        synonyms: ['흑백', '모노톤', '모노크롬', '무채색', '블랙앤화이트'],
        expansions: ['black and white monochrome image', 'greyscale photograph', 'single color monotone design', 'colorless achromatic tones'] },

    // 구성 · 움직임
    { id: 'dynamic', ko: '역동적인', group: 'extra',
        synonyms: ['역동', '다이나믹', '다이내믹', '움직임', '속도감', '동적인', '생동감'],
        expansions: ['dynamic energetic movement', 'motion and speed lines', 'diagonal explosive composition', 'action frozen mid-movement'] },
    { id: 'static', ko: '정적인', group: 'extra',
        synonyms: ['정적인', '정지된', '움직임 없는', '멈춰 있', '멈춘'],
        expansions: ['static still composition', 'frozen calm stable arrangement', 'centered motionless object', 'balanced unmoving scene'] },
    { id: 'symmetric', ko: '대칭적인', group: 'extra',
        synonyms: ['대칭', '시메트리', '좌우대칭', '데칼코마니'],
        expansions: ['perfectly symmetrical composition', 'mirrored reflection layout', 'centered balanced symmetry', 'kaleidoscope symmetric pattern'] },
    { id: 'asymmetric', ko: '비대칭', group: 'extra',
        synonyms: ['비대칭', '어시메트리', '불균형', '한쪽으로 쏠린'],
        expansions: ['asymmetrical off-balance composition', 'weight shifted to one side', 'uneven dynamic balance', 'off-center layout'] },
    { id: 'repetitive', ko: '반복적인', group: 'extra',
        synonyms: ['반복', '패턴', '리듬', '리드미컬', '연속'],
        expansions: ['repetitive pattern of identical elements', 'rhythmic repeated shapes', 'seamless tiled motif', 'sequence of many similar objects in rows'] },

    // 표현 방식
    { id: 'abstract', ko: '추상적인', group: 'extra',
        synonyms: ['추상', '앱스트랙트', '비구상'],
        expansions: ['abstract non-representational art', 'pure shapes colors and lines', 'abstract expressionist painting', 'nonfigurative composition'] },
    { id: 'realistic', ko: '사실적인', group: 'extra',
        synonyms: ['사실적', '리얼', '극사실', '현실적', '실사'],
        expansions: ['realistic photograph of real life', 'photorealistic detailed rendering', 'documentary style image', 'true to life depiction'] },
    { id: 'surreal', ko: '초현실적인', group: 'extra',
        synonyms: ['초현실', '쉬르', '비현실', '말이 안 되는'],
        expansions: ['surreal impossible scene', 'dreamlike juxtaposition of unrelated objects', 'floating objects defying gravity', 'surrealist strange landscape'] },
    { id: 'modern', ko: '모던한', group: 'extra',
        synonyms: ['모던', '현대적', '컨템포러리', '요즘 느낌'],
        expansions: ['modern contemporary clean design', 'current trendy aesthetic', 'sleek modern architecture and product', 'contemporary art direction'] },
    { id: 'digital', ko: '디지털적인', group: 'extra',
        synonyms: ['디지털', '컴퓨터', '픽셀', '스크린', '인터페이스'],
        expansions: ['digital computer generated graphics', 'pixel art and screen interface', 'digital rendering with gradients', 'software ui and code aesthetic'] },
    { id: 'analog', ko: '아날로그', group: 'extra',
        synonyms: ['아날로그', '필름', '인쇄물', '리소', '실크스크린', '손때'],
        expansions: ['analog film photograph with grain', 'printed matter with ink texture', 'risograph print', 'physical collage and photocopy'] },
    { id: 'brutal', ko: '브루탈한', group: 'extra',
        synonyms: ['브루탈', '콘크리트', '노출콘크리트'],
        expansions: ['brutalist raw concrete architecture', 'brutalist web design with raw default styles', 'heavy blocky harsh forms', 'unpolished bold stark layout'] },
    { id: 'y2k', ko: 'Y2K', group: 'extra',
        synonyms: ['y2k', '와이투케이', '2000년대', '밀레니엄'],
        expansions: ['y2k aesthetic with chrome and bubbles', 'early 2000s futuristic graphics', 'glossy iridescent millennium design', 'cyber pop y2k fashion'] },

    // 장소 · 문화
    { id: 'urban', ko: '도시적인', group: 'extra',
        synonyms: ['도시', '어반', '시티', '도회'],
        expansions: ['urban city street scene', 'skyscrapers and concrete cityscape', 'metropolitan night lights', 'street culture and signage'] },
    { id: 'natural', ko: '자연적인', group: 'extra',
        synonyms: ['자연', '내추럴', '네추럴', '숲', '식물'],
        expansions: ['natural landscape with plants and trees', 'earthy natural materials wood and stone', 'organic outdoor scenery', 'botanical leaves and flowers'] },
    { id: 'oriental', ko: '동양적인', group: 'extra',
        synonyms: ['동양', '오리엔탈', '아시안', '한국적', '동아시아', '전통 문양'],
        expansions: ['east asian traditional aesthetic', 'ink brush painting and calligraphy', 'korean traditional patterns and colors', 'asian architecture and ornament'] },
    { id: 'exotic', ko: '이국적인', group: 'extra',
        synonyms: ['이국', '엑조틱', '열대', '트로피컬', '남국'],
        expansions: ['exotic foreign tropical scene', 'tropical plants and vivid birds', 'faraway unfamiliar culture', 'lush jungle paradise'] },

    // 계절 · 시간
    { id: 'spring', ko: '봄 같은', group: 'extra',
        synonyms: ['봄'],
        expansions: ['spring blossoms and fresh green', 'soft pink cherry flowers', 'gentle warm spring light', 'new sprouts and pastel season'] },
    { id: 'summer', ko: '여름 같은', group: 'extra',
        synonyms: ['여름'],
        expansions: ['hot summer sunlight and blue sky', 'beach pool and sea', 'bright saturated summer colors', 'lush green summer vacation'] },
    { id: 'autumn', ko: '가을 같은', group: 'extra',
        synonyms: ['가을'],
        expansions: ['autumn leaves in orange and brown', 'warm golden fall light', 'cozy harvest season tones', 'falling leaves and amber colors'] },
    { id: 'winter', ko: '겨울 같은', group: 'extra',
        synonyms: ['겨울', '눈 오는', '설경'],
        expansions: ['snowy winter landscape', 'frost and ice in cold light', 'white snow and bare trees', 'winter clothing and breath fog'] },
    { id: 'night', ko: '밤 같은', group: 'extra',
        synonyms: ['밤', '야간', '새벽', '심야', '야경', '네온'],
        expansions: ['night scene with artificial lights', 'dark blue dawn atmosphere', 'neon signs glowing at night', 'late night city glow'] }
];

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

// 앱 시작 시 AI가 만든 키워드와 학습된 표현을 사전에 합친다
for (const k of readJson(CUSTOM_FILE, [])) KEYWORDS.push(k);
for (const [id, syns] of Object.entries(readJson(LEARNED_FILE, {}))) {
    const k = KEYWORDS.find((x) => x.id === id);
    if (k) syns.forEach((s) => { if (!k.synonyms.includes(s)) k.synonyms.push(s); });
}

export function addCustomKeyword(keyword) {
    KEYWORDS.push(keyword);
    fs.writeFileSync(CUSTOM_FILE, JSON.stringify(KEYWORDS.filter((k) => k.group === 'custom'), null, 1));
}

export function addLearnedSynonym(id, synonym) {
    const k = KEYWORDS.find((x) => x.id === id);
    if (!k || k.synonyms.includes(synonym)) return;
    k.synonyms.push(synonym);
    const learned = readJson(LEARNED_FILE, {});
    (learned[id] ??= []).push(synonym);
    fs.writeFileSync(LEARNED_FILE, JSON.stringify(learned, null, 1));
}

// 키워드가 아닌 연결어/군더더기. 사전에서 못 찾은 말 중 이것들은 AI에게 묻지 않는다
const FILLER = new Set(['느낌', '느낌의', '같은', '같이', '하고', '이고', '인데', '그리고', '그런', '이런', '좀', '약간', '조금', '많이', '아주', '너무', '엄청', '되게', '사진', '이미지', '레퍼런스', '스타일', '분위기', '분위기의', '많은', '있는', '없는', '위주', '위주로', '들어간', '나오는', '느낌으로']);

/**
 * 자유롭게 쓴 검색 문장에서 키워드를 찾아낸다. 긴 동의어부터 매칭해서
 * "밀도가 높은"이 "밀도"보다, "눈 아픈"이 다른 키워드보다 먼저 잡히게 한다.
 * unknown: 사전에서 못 찾은 나머지 말 (연결어, 한 글자짜리 어미 조각은 뺀다)
 */
export function parseQuery(text) {
    let rest = text.toLowerCase();
    const ids = [];
    // 같은 표현이 키워드 여러 개에 연결될 수 있다 (AI가 "칙칙" → 채도 낮은 + 어두운 으로 학습시킨 경우)
    const idsOf = new Map();
    KEYWORDS.forEach((k) => k.synonyms.forEach((s) => {
        const key = s.toLowerCase();
        idsOf.set(key, [...(idsOf.get(key) ?? []), k.id]);
    }));
    const entries = [...idsOf].sort((a, b) => b[0].length - a[0].length);
    for (const [syn, synIds] of entries) {
        // 단어 첫머리에서 시작하는 경우만 인정한다 - "감정적인"의 '정적', "돌봄"의 '봄'처럼 단어 중간에 낀 글자는 무시
        const at = new RegExp(`(^|[^\\p{L}\\p{N}])${syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\p{L}\\p{N}]*`, 'u');
        if (at.test(rest)) {
            synIds.forEach((id) => { if (!ids.includes(id)) ids.push(id); });
            // 매칭된 말은 어미까지 통째로 지운다 ("차가운데"의 '데'가 남아 모르는 말로 취급되지 않게)
            rest = rest.replace(new RegExp(at.source, 'gu'), '$1 ');
        }
    }
    const unknown = rest.split(/[\s,./·+&]+/).filter((t) => t.length >= 2 && !FILLER.has(t));
    return { ids, unknown };
}

export const parseKeywords = (text) => parseQuery(text).ids;
