/**
 * 처음 온 사람에게 게임 튜토리얼처럼 한 장씩 넘기며 보여주는 "내 핀 가져오기" 안내.
 *   환영 → ① Pinterest에 데이터 요청 → ② 메일로 온 ZIP 받기 → ③ 여기에 올리기 → 완료
 * Pinterest 공식 연동(API)은 아직 심사 중이라, 그 전까지는 Pinterest "데이터 요청" 내보내기 파일로 가져온다.
 *
 * 로그인했는데 핀이 하나도 없으면 자동으로 열리고(Onboarding.maybeAutoOpen),
 * 개인 페이지·빈 터널의 "핀 가져오기" 버튼으로 언제든 다시 열 수 있다(Onboarding.open).
 * supabase-client.js, pinterest-export.js 다음에 불러온다. ZIP을 푸는 JSZip은 실제로 올릴 때만 받는다.
 */
const Onboarding = (() => {
    const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    const IMPORT_BATCH = 500;
    // "나중에 할게요"를 누르면 이 시간 동안은 자동으로 다시 열지 않는다
    const SNOOZE_MS = 24 * 60 * 60 * 1000;

    let root = null;
    let step = 0;
    let me = null;          // { id, username }
    let foundPins = [];
    let onFinished = null;

    const STEPS = ['welcome', 'request', 'download', 'upload', 'done', 'taste-words', 'taste-round', 'taste-result'];
    // 감각 테스트: 단어 하나에 보여줄 내 핀 수, 고를 수 있는 단어 수, 한 번에 보여줄 추천 단어 수
    const ROUND_SIZE = 12;
    const MAX_WORDS = 5;
    const SUGGESTION_COUNT = 14;
    // 다시 할 때 이미 그 단어로 고른 핀을 몇 장까지 다시 보여줄지 (빼면 그 단어가 지워진다 - 감각이 바뀐 것)
    const RECHECK_PER_WORD = 4;

    const taste = {
        vocab: [],          // 추천 단어 (느낌 키워드 이름들)
        suggestions: [],
        words: [],          // 고른 단어
        pins: [],           // 내 핀 { id, image, customTags }
        rounds: [],         // [{ word, pins: [...], chosen: Set(pin id), preselected: Set }]
        roundIndex: 0
    };

    // ── 화면 ────────────────────────────────────────────────

    function build() {
        root = document.createElement('div');
        root.className = 'ob-overlay hidden';
        root.innerHTML = `
            <div class="ob-card" role="dialog" aria-modal="true" aria-labelledby="ob-title">
                <button type="button" class="ob-close" aria-label="닫기">&times;</button>
                <div class="ob-progress">${STEPS.map(() => '<span></span>').join('')}</div>

                <section class="ob-step" data-step="welcome">
                    <div class="ob-visual ob-visual-tunnel">${miniTunnel()}</div>
                    <div class="ob-kicker">WELCOME</div>
                    <h2 class="ob-title" id="ob-title">내 핀이 3D 터널이 됩니다</h2>
                    <p class="ob-text">Pinterest에 모아 둔 이미지가 끝없이 흐르는 터널이 돼요.
                    나만의 감각을 키워드로 만들어 보세요.</p>
                    <p class="ob-text ob-muted">먼저 내 핀을 가져와야 해요. 3단계면 끝나요.</p>
                    <div class="ob-actions">
                        <button type="button" class="ob-btn ob-btn-ghost" data-action="later">나중에 할게요</button>
                        <button type="button" class="ob-btn ob-btn-primary" data-action="next">시작하기 →</button>
                    </div>
                </section>

                <section class="ob-step" data-step="request">
                    <div class="ob-kicker">STEP 1 / 3</div>
                    <h2 class="ob-title">Pinterest에 내 데이터 요청하기</h2>
                    <div class="ob-path">
                        <span>설정</span><b>›</b><span>개인정보 보호 및 데이터</span><b>›</b><span class="ob-path-hit">데이터 요청</span>
                    </div>
                    <ol class="ob-list">
                        <li>아래 버튼으로 Pinterest 설정을 열어요 (Pinterest에 로그인돼 있어야 해요)</li>
                        <li><b>개인정보 보호 및 데이터</b>(Privacy and data)에서 <b>데이터 요청</b>(Request your data)을 눌러요</li>
                        <li>Pinterest가 내 데이터를 정리해서 <b>메일로 보내 줘요</b>. 보통 몇 분, 길면 하루 이틀 걸려요</li>
                    </ol>
                    <a class="ob-btn ob-btn-outline ob-btn-wide" href="https://www.pinterest.com/settings/privacy" target="_blank" rel="noopener">Pinterest 설정 열기 ↗</a>
                    <div class="ob-actions">
                        <button type="button" class="ob-btn ob-btn-ghost" data-action="back">← 이전</button>
                        <button type="button" class="ob-btn ob-btn-ghost" data-action="skip-to-upload">이미 ZIP이 있어요</button>
                        <button type="button" class="ob-btn ob-btn-primary" data-action="next">요청했어요 →</button>
                    </div>
                </section>

                <section class="ob-step" data-step="download">
                    <div class="ob-kicker">STEP 2 / 3</div>
                    <h2 class="ob-title">메일로 온 ZIP 파일 받기</h2>
                    <ol class="ob-list">
                        <li>Pinterest에서 온 메일의 <b>다운로드</b> 링크를 눌러 <b>ZIP 파일</b>을 받아요</li>
                        <li>압축은 <b>풀지 않아도 돼요</b> - ZIP 그대로 다음 단계에 올리면 돼요</li>
                    </ol>
                    <p class="ob-text ob-muted">메일이 아직 안 왔으면 이 창을 닫아도 괜찮아요. 다음에 들어오면 이어서 할 수 있어요.</p>
                    <div class="ob-actions">
                        <button type="button" class="ob-btn ob-btn-ghost" data-action="back">← 이전</button>
                        <button type="button" class="ob-btn ob-btn-ghost" data-action="later">메일 기다릴게요</button>
                        <button type="button" class="ob-btn ob-btn-primary" data-action="next">받았어요 →</button>
                    </div>
                </section>

                <section class="ob-step" data-step="upload">
                    <div class="ob-kicker">STEP 3 / 3</div>
                    <h2 class="ob-title">ZIP 파일 올리기</h2>
                    <label class="ob-drop" data-drop>
                        <input type="file" accept=".zip,.html,application/zip" multiple hidden data-file>
                        <span class="ob-drop-icon">⇪</span>
                        <span class="ob-drop-text">여기로 ZIP 파일을 끌어다 놓거나 <u>눌러서 고르세요</u></span>
                        <span class="ob-drop-hint">압축을 풀었다면 pins 폴더 안의 0001.html, 0002.html … 을 한꺼번에 골라도 돼요</span>
                    </label>
                    <div class="ob-found hidden" data-found>
                        <div class="ob-found-count" data-found-count></div>
                        <div class="ob-found-preview" data-found-preview></div>
                    </div>
                    <div class="ob-bar hidden" data-bar><span data-bar-fill></span></div>
                    <div class="ob-status" data-status></div>
                    <div class="ob-actions">
                        <button type="button" class="ob-btn ob-btn-ghost" data-action="back">← 이전</button>
                        <button type="button" class="ob-btn ob-btn-primary" data-action="import" disabled>가져오기</button>
                    </div>
                </section>

                <section class="ob-step" data-step="done">
                    <div class="ob-visual ob-visual-tunnel">${miniTunnel()}</div>
                    <div class="ob-kicker">PINS READY</div>
                    <h2 class="ob-title" data-done-title>다 됐어요!</h2>
                    <p class="ob-text">이제 내 감각을 키워드로 만들어 볼까요?
                    단어를 고르고, 내 핀 중에서 그 느낌인 이미지를 골라 보세요. 1~2분이면 돼요.</p>
                    <div class="ob-actions">
                        <a class="ob-btn ob-btn-ghost" data-link="tunnel" href="#">나중에 · 터널로 가기</a>
                        <button type="button" class="ob-btn ob-btn-primary" data-action="taste-start">감각 테스트 시작 →</button>
                    </div>
                </section>

                <section class="ob-step" data-step="taste-words">
                    <div class="ob-kicker">MY KEYWORDS</div>
                    <h2 class="ob-title">어떤 단어로 내 감각을 만들까요?</h2>
                    <p class="ob-text ob-muted">마음에 드는 단어를 골라요 (최대 ${MAX_WORDS}개). 없으면 직접 써도 돼요.</p>
                    <div class="ob-chips" data-word-chips></div>
                    <div class="ob-word-tools">
                        <button type="button" class="ob-text-btn" data-action="taste-shuffle">↻ 다른 단어 보기</button>
                    </div>
                    <form class="ob-own-word" data-own-word-form>
                        <input type="text" maxlength="12" placeholder="내 단어 직접 쓰기 (예: 새벽 같은)" data-own-word>
                        <button type="submit" class="ob-btn ob-btn-outline">추가</button>
                    </form>
                    <div class="ob-selected" data-selected-words></div>
                    <div class="ob-status" data-taste-status></div>
                    <div class="ob-actions">
                        <button type="button" class="ob-btn ob-btn-ghost" data-action="later">나중에 할게요</button>
                        <button type="button" class="ob-btn ob-btn-primary" data-action="taste-begin" disabled>시작 →</button>
                    </div>
                </section>

                <section class="ob-step" data-step="taste-round">
                    <div class="ob-kicker" data-round-kicker></div>
                    <h2 class="ob-title" data-round-title></h2>
                    <p class="ob-text ob-muted">눈에 들어오는 대로 골라요. 정답은 없어요. 하나도 없으면 그냥 넘어가도 돼요.</p>
                    <div class="ob-pick-grid" data-pick-grid></div>
                    <div class="ob-actions">
                        <span class="ob-pick-count" data-pick-count></span>
                        <button type="button" class="ob-btn ob-btn-primary" data-action="taste-next">다음 →</button>
                    </div>
                </section>

                <section class="ob-step" data-step="taste-result">
                    <div class="ob-kicker">MY KEYWORDS</div>
                    <h2 class="ob-title">내 감각이 키워드가 됐어요</h2>
                    <p class="ob-text ob-muted">고른 이미지에 단어가 붙었어요. 터널에서 이 단어로 검색하면 내가 고른 이미지가 나와요.
                    감각은 바뀌니까, 개인 페이지에서 언제든 다시 할 수 있어요.</p>
                    <div class="ob-result" data-taste-result></div>
                    <div class="ob-status" data-save-status></div>
                    <div class="ob-actions">
                        <a class="ob-btn ob-btn-ghost" data-link="profile" href="#">개인 페이지 보기</a>
                        <a class="ob-btn ob-btn-primary" data-link="search" href="#">내 터널에서 검색해 보기 →</a>
                    </div>
                </section>
            </div>`;
        document.body.appendChild(root);

        root.querySelector('.ob-close').addEventListener('click', () => close(true));
        root.addEventListener('click', (e) => {
            if (e.target === root) close(true);
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action === 'next') show(step + 1);
            if (action === 'back') show(step - 1);
            if (action === 'later') close(true);
            if (action === 'skip-to-upload') show(STEPS.indexOf('upload'));
            if (action === 'import') runImport();
            if (action === 'taste-start') startTaste();
            if (action === 'taste-shuffle') shuffleSuggestions();
            if (action === 'taste-begin') beginRounds();
            if (action === 'taste-next') nextRound();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !root.classList.contains('hidden')) close(true);
        });

        const drop = root.querySelector('[data-drop]');
        const fileInput = root.querySelector('[data-file]');
        fileInput.addEventListener('change', () => {
            readFiles(fileInput.files);
            // 같은 파일을 다시 골라도 change가 오도록 비워 둔다
            fileInput.value = '';
        });
        ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', (e) => readFiles(e.dataTransfer.files));

        root.querySelector('[data-own-word-form]').addEventListener('submit', (e) => {
            e.preventDefault();
            const input = root.querySelector('[data-own-word]');
            addWord(input.value);
            input.value = '';
        });
    }

    function miniTunnel() {
        let rings = '';
        for (let r = 0; r < 5; r++) {
            let cards = '';
            for (let c = 0; c < 12; c++) {
                const angle = ((c + (r % 2) * 0.5) / 12) * 360;
                cards += `<i style="transform: rotate(${angle}deg) translateY(-46px)"></i>`;
            }
            rings += `<div class="ob-ring" style="animation-delay:${(-r * 2000) / 5}ms">${cards}</div>`;
        }
        return rings;
    }

    function show(index) {
        step = Math.max(0, Math.min(STEPS.length - 1, index));
        root.querySelectorAll('.ob-step').forEach((el) => el.classList.toggle('active', el.dataset.step === STEPS[step]));
        root.querySelectorAll('.ob-progress span').forEach((el, i) => el.classList.toggle('on', i <= step));
    }

    function close(snooze) {
        root.classList.add('hidden');
        if (snooze && me) {
            try { localStorage.setItem(`onboarding-snooze-${me.id}`, String(Date.now())); } catch (e) { /* 저장 못 해도 그만 */ }
        }
    }

    // ── 파일 읽기 ───────────────────────────────────────────

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error('압축 해제 도구를 불러오지 못했습니다'));
            document.head.appendChild(s);
        });
    }

    function setStatus(text, isError = false) {
        const el = root.querySelector('[data-status]');
        el.textContent = text;
        el.classList.toggle('error', isError);
    }

    async function readFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        foundPins = [];
        root.querySelector('[data-action="import"]').disabled = true;
        root.querySelector('[data-found]').classList.add('hidden');
        setStatus('파일을 읽는 중...');

        try {
            const pages = [];
            for (const file of files) {
                if (/\.zip$/i.test(file.name) || file.type.includes('zip')) {
                    if (!window.JSZip) await loadScript(JSZIP_URL);
                    const zip = await window.JSZip.loadAsync(file);
                    const entries = Object.values(zip.files).filter((f) => !f.dir && PinterestExport.isPinsPage(f.name));
                    for (const entry of entries) pages.push(await entry.async('string'));
                } else if (/\.html?$/i.test(file.name)) {
                    pages.push(await file.text());
                }
            }

            const raw = pages.flatMap((html) => PinterestExport.parsePinsPage(html));
            foundPins = PinterestExport.toImportPins(raw);
            if (!foundPins.length) {
                setStatus('핀을 찾지 못했어요. Pinterest "데이터 요청"으로 받은 ZIP 파일이 맞는지 확인해 주세요.', true);
                return;
            }
            renderFound();
            setStatus('');
            root.querySelector('[data-action="import"]').disabled = false;
        } catch (err) {
            console.warn('내보내기 파일 읽기 실패:', err);
            setStatus(`파일을 읽지 못했어요: ${err.message}`, true);
        }
    }

    function renderFound() {
        root.querySelector('[data-found]').classList.remove('hidden');
        root.querySelector('[data-found-count]').textContent = `핀 ${foundPins.length.toLocaleString()}개를 찾았어요`;
        const preview = root.querySelector('[data-found-preview]');
        preview.replaceChildren();
        foundPins.slice(0, 10).forEach((pin) => {
            const img = document.createElement('img');
            img.src = pin.image.replace('/736x/', '/236x/');
            img.alt = '';
            img.loading = 'lazy';
            preview.appendChild(img);
        });
    }

    function resetUpload() {
        foundPins = [];
        setStatus('');
        root.querySelector('[data-found]').classList.add('hidden');
        root.querySelector('[data-bar]').classList.add('hidden');
        root.querySelector('[data-bar-fill]').style.width = '0';
        root.querySelector('[data-action="import"]').disabled = true;
    }

    // ── 가져오기 ────────────────────────────────────────────

    async function runImport() {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            setStatus('로그인이 필요해요. 메인 페이지에서 로그인한 뒤 다시 해 주세요.', true);
            return;
        }
        const button = root.querySelector('[data-action="import"]');
        const bar = root.querySelector('[data-bar]');
        const fill = root.querySelector('[data-bar-fill]');
        button.disabled = true;
        bar.classList.remove('hidden');

        let inserted = 0;
        try {
            for (let i = 0; i < foundPins.length; i += IMPORT_BATCH) {
                const batch = foundPins.slice(i, i + IMPORT_BATCH);
                setStatus(`가져오는 중... ${Math.min(i + batch.length, foundPins.length).toLocaleString()} / ${foundPins.length.toLocaleString()}`);
                const response = await fetch('/api/pins/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                    body: JSON.stringify({ pins: batch })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || response.status);
                inserted += data.inserted || 0;
                fill.style.width = `${((i + batch.length) / foundPins.length) * 100}%`;
            }
        } catch (err) {
            console.warn('핀 가져오기 실패:', err);
            setStatus(`중간에 멈췄어요 (${inserted.toLocaleString()}개까지 저장됨): ${err.message}. 다시 누르면 이어서 가져와요.`, true);
            button.disabled = false;
            return;
        }

        try { localStorage.removeItem(`onboarding-snooze-${me.id}`); } catch (e) { /* 무시 */ }
        const skipped = foundPins.length - inserted;
        root.querySelector('[data-done-title]').textContent = inserted
            ? `핀 ${inserted.toLocaleString()}개를 가져왔어요!`
            : '새로 가져올 핀이 없어요 - 이미 다 들어와 있어요';
        if (inserted && skipped) root.querySelector('[data-done-title]').textContent += ` (이미 있던 ${skipped.toLocaleString()}개는 건너뜀)`;
        show(STEPS.indexOf('done'));
        if (onFinished) onFinished(inserted);
    }

    // ── 감각 테스트: 내 핀에서 단어마다 "그 느낌인 이미지"를 고르면, 고른 핀에 그 단어가 키워드로 붙는다 ──

    const shuffle = (list) => {
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };

    const smallImage = (image) => {
        if (/^https:\/\/i\.pinimg\.com\/(736x|originals)\//.test(image)) return image.replace(/\/(736x|originals)\//, '/236x/');
        if (image.startsWith('/images/') && !image.startsWith('/images/t/')) return image.replace(/^\/images\/([^/]+)\.[^.]+$/, '/images/t/$1.webp');
        return image;
    };

    function setTasteStatus(text, isError = false) {
        const el = root.querySelector('[data-taste-status]');
        el.textContent = text;
        el.classList.toggle('error', isError);
    }

    async function startTaste() {
        me = me || await loadMe();
        taste.words = [];
        renderSelectedWords();
        show(STEPS.indexOf('taste-words'));
        setTasteStatus('');
        try {
            if (!taste.vocab.length) {
                const data = await (await fetch('/api/search/vocab')).json();
                taste.vocab = (data.keywords || []).map((k) => k.ko);
            }
            shuffleSuggestions();
            // 내 핀 (가져온 직후라도 바로 보이도록 서버 캐시를 거치지 않고 직접 읽는다)
            const { data, error } = await supabaseClient.from('pins')
                .select('id, image, custom_tags').eq('owner_id', me.id).neq('image', '').limit(2000);
            if (error) throw error;
            taste.pins = (data || []).filter((p) => p.image).map((p) => ({ id: p.id, image: p.image, customTags: p.custom_tags || [] }));
            if (taste.pins.length < 4) setTasteStatus('핀이 너무 적어요. 먼저 핀을 가져와 주세요.', true);
        } catch (err) {
            setTasteStatus(`내 핀을 불러오지 못했어요: ${err.message}`, true);
        }
    }

    function shuffleSuggestions() {
        taste.suggestions = shuffle(taste.vocab).slice(0, SUGGESTION_COUNT);
        renderWordChips();
    }

    function renderWordChips() {
        const box = root.querySelector('[data-word-chips]');
        box.replaceChildren();
        taste.suggestions.forEach((word) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'ob-chip';
            chip.textContent = word;
            chip.classList.toggle('on', taste.words.includes(word));
            chip.addEventListener('click', () => (taste.words.includes(word) ? removeWord(word) : addWord(word)));
            box.appendChild(chip);
        });
    }

    function addWord(raw) {
        const word = String(raw || '').trim().replace(/\s+/g, ' ');
        if (!word || taste.words.includes(word)) return;
        if (taste.words.length >= MAX_WORDS) {
            setTasteStatus(`단어는 ${MAX_WORDS}개까지 고를 수 있어요`, true);
            return;
        }
        setTasteStatus('');
        taste.words.push(word);
        renderSelectedWords();
        renderWordChips();
    }

    function removeWord(word) {
        taste.words = taste.words.filter((w) => w !== word);
        setTasteStatus('');
        renderSelectedWords();
        renderWordChips();
    }

    function renderSelectedWords() {
        const box = root.querySelector('[data-selected-words]');
        box.replaceChildren();
        taste.words.forEach((word) => {
            const tag = document.createElement('button');
            tag.type = 'button';
            tag.className = 'ob-chip on';
            tag.textContent = `${word} ×`;
            tag.addEventListener('click', () => removeWord(word));
            box.appendChild(tag);
        });
        root.querySelector('[data-action="taste-begin"]').disabled = taste.words.length === 0 || taste.pins.length < 4;
        root.querySelector('[data-action="taste-begin"]').textContent = taste.words.length
            ? `${taste.words.length}개 단어로 시작 →` : '시작 →';
    }

    function beginRounds() {
        // 단어마다 서로 다른 핀을 보여준다 (핀이 모자라면 겹칠 수 있다)
        let pool = shuffle(taste.pins);
        taste.rounds = taste.words.map((word) => {
            // 다시 하는 경우: 전에 이 단어로 고른 핀 몇 장은 다시 보여준다 (안 고르면 그 단어가 빠진다)
            const previous = shuffle(taste.pins.filter((p) => p.customTags.includes(word))).slice(0, RECHECK_PER_WORD);
            const fresh = [];
            while (fresh.length < ROUND_SIZE - previous.length) {
                if (!pool.length) pool = shuffle(taste.pins);
                const pin = pool.pop();
                if (!previous.includes(pin) && !fresh.includes(pin)) fresh.push(pin);
                if (fresh.length + previous.length >= taste.pins.length) break;
            }
            const pins = shuffle([...previous, ...fresh]);
            const preselected = new Set(previous.map((p) => p.id));
            return { word, pins, chosen: new Set(preselected), preselected };
        });
        taste.roundIndex = 0;
        renderRound();
        show(STEPS.indexOf('taste-round'));
    }

    function renderRound() {
        const round = taste.rounds[taste.roundIndex];
        root.querySelector('[data-round-kicker]').textContent = `WORD ${taste.roundIndex + 1} / ${taste.rounds.length}`;
        root.querySelector('[data-round-title]').textContent = `'${round.word}' 느낌인 이미지를 골라 보세요`;
        const grid = root.querySelector('[data-pick-grid]');
        grid.replaceChildren();
        round.pins.forEach((pin) => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'ob-pick';
            cell.classList.toggle('on', round.chosen.has(pin.id));
            const img = document.createElement('img');
            img.src = smallImage(pin.image);
            img.alt = '';
            img.onerror = () => { img.onerror = null; img.src = pin.image; };
            cell.appendChild(img);
            cell.addEventListener('click', () => {
                if (round.chosen.has(pin.id)) round.chosen.delete(pin.id);
                else round.chosen.add(pin.id);
                cell.classList.toggle('on', round.chosen.has(pin.id));
                renderPickCount();
            });
            grid.appendChild(cell);
        });
        renderPickCount();
        root.querySelector('[data-action="taste-next"]').textContent = taste.roundIndex === taste.rounds.length - 1 ? '완료 →' : '다음 →';
    }

    function renderPickCount() {
        const round = taste.rounds[taste.roundIndex];
        root.querySelector('[data-pick-count]').textContent = `${round.chosen.size}장 고름`;
    }

    function nextRound() {
        if (taste.roundIndex < taste.rounds.length - 1) {
            taste.roundIndex += 1;
            renderRound();
            root.querySelector('.ob-card').scrollTop = 0;
            return;
        }
        finishTaste();
    }

    /** 고른 핀에는 그 단어를 붙이고, 보여줬는데 안 고른 핀에서는 그 단어를 뗀다 (감각 갱신) */
    async function finishTaste() {
        show(STEPS.indexOf('taste-result'));
        renderResult();
        const status = root.querySelector('[data-save-status]');
        status.classList.remove('error');
        status.textContent = '저장하는 중...';

        const newTags = new Map();
        const tagsOf = (pin) => newTags.get(pin.id) || pin.customTags.slice();
        taste.rounds.forEach((round) => {
            round.pins.forEach((pin) => {
                const tags = tagsOf(pin);
                const has = tags.includes(round.word);
                if (round.chosen.has(pin.id) && !has) tags.push(round.word);
                if (!round.chosen.has(pin.id) && has) tags.splice(tags.indexOf(round.word), 1);
                newTags.set(pin.id, tags);
            });
        });
        const changed = [...newTags].filter(([id, tags]) => {
            const before = taste.pins.find((p) => p.id === id).customTags;
            return before.length !== tags.length || before.some((t) => !tags.includes(t));
        });

        try {
            for (let i = 0; i < changed.length; i += 8) {
                await Promise.all(changed.slice(i, i + 8).map(async ([id, tags]) => {
                    const { error } = await supabaseClient.from('pins').update({ custom_tags: tags }).eq('id', id);
                    if (error) throw error;
                    taste.pins.find((p) => p.id === id).customTags = tags;
                }));
            }
            status.textContent = '저장했어요';
            if (onTasteSaved) onTasteSaved();
        } catch (err) {
            status.classList.add('error');
            status.textContent = `저장하지 못했어요: ${err.message}`;
        }

        const firstWord = (taste.rounds.find((r) => r.chosen.size) || taste.rounds[0]).word;
        const search = root.querySelector('[data-link="search"]');
        search.href = `gallery.html?user=${encodeURIComponent(me.username)}&q=${encodeURIComponent(firstWord)}`;
        search.textContent = `터널에서 '${firstWord}' 검색해 보기 →`;
    }

    function renderResult() {
        const box = root.querySelector('[data-taste-result]');
        box.replaceChildren();
        taste.rounds.forEach((round) => {
            const row = document.createElement('div');
            row.className = 'ob-result-row';
            const head = document.createElement('div');
            head.className = 'ob-result-head';
            head.innerHTML = '<b></b><span></span>';
            head.querySelector('b').textContent = round.word;
            head.querySelector('span').textContent = round.chosen.size
                ? `${round.pins.length}장 중 ${round.chosen.size}장`
                : '고른 이미지 없음';
            const thumbs = document.createElement('div');
            thumbs.className = 'ob-result-thumbs';
            round.pins.filter((p) => round.chosen.has(p.id)).slice(0, 6).forEach((pin) => {
                const img = document.createElement('img');
                img.src = smallImage(pin.image);
                img.alt = '';
                thumbs.appendChild(img);
            });
            row.append(head, thumbs);
            box.appendChild(row);
        });
    }

    let onTasteSaved = null;

    // ── 공개 함수 ───────────────────────────────────────────

    async function loadMe() {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return null;
        const { data } = await supabaseClient.from('profiles').select('id, username, username_is_placeholder').eq('id', session.user.id).maybeSingle();
        return data || null;
    }

    /** 안내를 연다. startAt: 'welcome' | 'upload' 등. onDone(가져온 개수): 다 가져온 뒤 불린다 */
    async function open({ startAt = 'welcome', onDone = null, onTaste = null } = {}) {
        if (!root) build();
        me = me || await loadMe();
        onFinished = onDone;
        onTasteSaved = onTaste;
        const links = root.querySelectorAll('[data-link]');
        if (me) {
            links.forEach((a) => {
                a.href = a.dataset.link === 'tunnel'
                    ? `gallery.html?user=${encodeURIComponent(me.username)}`
                    : `profile.html?user=${encodeURIComponent(me.username)}`;
            });
        }
        resetUpload();
        root.classList.remove('hidden');
        if (startAt === 'taste') startTaste();
        else show(STEPS.indexOf(startAt));
    }

    /** 로그인했고, 핀이 하나도 없고, 최근에 "나중에"를 누르지 않았으면 연다 */
    async function maybeAutoOpen(options = {}) {
        // 이미 열려 있으면(로그인 상태 변화로 여러 번 불려도) 보던 단계를 처음으로 되돌리지 않는다
        if (root && !root.classList.contains('hidden')) return;
        me = await loadMe();
        // 구글/카카오 첫 가입이라 사용자명을 아직 안 정했으면 그 창이 먼저다
        if (!me || me.username_is_placeholder) return;
        try {
            const snoozed = Number(localStorage.getItem(`onboarding-snooze-${me.id}`) || 0);
            if (Date.now() - snoozed < SNOOZE_MS) return;
        } catch (e) { /* localStorage를 못 쓰면 그냥 확인한다 */ }
        const { count } = await supabaseClient.from('pins').select('id', { count: 'exact', head: true }).eq('owner_id', me.id);
        if (count === 0) open(options);
    }

    return { open, maybeAutoOpen };
})();
