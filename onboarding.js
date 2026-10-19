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

    const STEPS = ['welcome', 'request', 'download', 'upload', 'sync', 'done', 'taste-words', 'taste-round', 'taste-result', 'tune-tip'];
    // 감각 테스트: 단어 하나에 보여줄 내 핀 수, 고를 수 있는 단어 수, 한 번에 보여줄 추천 단어 수
    // 20장: 시뮬레이션에서 12장보다 처음 보는 사진을 훨씬 잘 맞혔다 (일치도 0.73 → 0.85, simulate-test.mjs)
    const ROUND_SIZE = 20;
    const MAX_WORDS = 5;
    // 최소 단어 수: 이보다 적으면 그 사람의 감각 프로필이라고 하기엔 너무 적다
    const MIN_WORDS = 3;
    // 단어마다 첫 라운드 뒤에 붙는 "확인" 라운드 사진 수 - 첫 라운드에서 고른 사진과 닮은 사진들
    // (시뮬레이션: 첫 라운드 20장만 0.78 → 확인 12장을 더하면 0.86, simulate-realistic.mjs)
    const CONFIRM_SIZE = 12;
    const SUGGESTION_COUNT = 14;
    // 그중 항상 보여줄 단어 수 (테스트 추천 순서의 맨 앞)
    const FIXED_SUGGESTIONS = 8;
    // 다시 할 때 이미 그 단어로 고른 핀을 몇 장까지 다시 보여줄지 (빼면 그 단어가 지워진다 - 감각이 바뀐 것)
    const RECHECK_PER_WORD = 4;

    const taste = {
        vocab: [],          // 추천 단어 (느낌 키워드 이름들)
        testOrder: [],      // 물어볼 가치가 큰 순서 (사람마다 판단이 갈리는 단어가 앞)
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
                    <p class="ob-text ob-muted">감각은 한 번에 정해지지 않아요. 쓰면서 검색 결과가 내 느낌과 다르면
                    그때그때 몇 장만 골라 맞춰 갈 수 있어요.</p>
                    <p class="ob-text ob-muted" data-welcome-hint>먼저 내 핀을 가져와야 해요. Pinterest 계정을 연결하면 바로 가져와요.</p>
                    <div class="ob-status" data-welcome-status></div>
                    <div class="ob-actions">
                        <button type="button" class="ob-btn ob-btn-ghost" data-action="later">나중에 할게요</button>
                        <button type="button" class="ob-btn ob-btn-primary" data-action="connect-pinterest">Pinterest 계정 연결하기 →</button>
                    </div>
                    <div class="ob-word-tools">
                        <button type="button" class="ob-text-btn" data-action="next" data-zip-path>Pinterest 데이터 파일(ZIP)로 가져오기</button>
                    </div>
                </section>

                <section class="ob-step" data-step="sync">
                    <div class="ob-visual ob-visual-tunnel">${miniTunnel()}</div>
                    <div class="ob-kicker">PINTEREST</div>
                    <h2 class="ob-title">Pinterest에서 내 핀을 가져오는 중</h2>
                    <p class="ob-text ob-muted">보드가 많으면 1~2분 걸릴 수 있어요. 이 창을 열어 두세요.</p>
                    <div class="ob-status" data-sync-status></div>
                    <div class="ob-actions">
                        <button type="button" class="ob-btn ob-btn-ghost" data-action="later">닫기</button>
                        <button type="button" class="ob-btn ob-btn-primary hidden" data-action="sync-retry">다시 시도</button>
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
                    <div class="ob-status ob-analysis" data-analysis-status></div>
                    <div class="ob-actions">
                        <a class="ob-btn ob-btn-ghost" data-link="tunnel" href="#">나중에 · 터널로 가기</a>
                        <button type="button" class="ob-btn ob-btn-primary" data-action="taste-start">감각 테스트 시작 →</button>
                    </div>
                </section>

                <section class="ob-step" data-step="taste-words">
                    <div class="ob-kicker">MY KEYWORDS</div>
                    <h2 class="ob-title">어떤 단어로 내 감각을 만들까요?</h2>
                    <p class="ob-text ob-muted">마음에 드는 단어를 ${MIN_WORDS}~${MAX_WORDS}개 골라요. 없으면 직접 써도 돼요. 단어마다 두 번씩 물어봐요.</p>
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
                    <div class="ob-status ob-analysis" data-analysis-status></div>
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
                    <p class="ob-text ob-muted" data-result-text>고른 이미지와 안 고른 이미지로 내 감각을 배웠어요. 터널에서 이 단어로 검색하면
                    테스트에 나오지 않은 핀까지 내 느낌대로 찾아 줘요.</p>
                    <p class="ob-text ob-muted">감각은 쓰면서 계속 맞춰져요. 검색 결과가 내 느낌과 다르면 검색창 아래
                    <b>'결과 다듬기'</b>를 눌러 몇 장만 더 골라 주세요. 할 때마다 더 정확해져요.</p>
                    <div class="ob-result" data-taste-result></div>
                    <div class="ob-status" data-save-status></div>
                    <div class="ob-actions">
                        <a class="ob-btn ob-btn-ghost" data-link="profile" href="#">개인 페이지 보기</a>
                        <a class="ob-btn ob-btn-primary" data-link="search" href="#">내 터널에서 검색해 보기 →</a>
                        <button type="button" class="ob-btn ob-btn-primary hidden" data-action="close-tuned">검색 결과 다시 보기 →</button>
                    </div>
                </section>

                <section class="ob-step" data-step="tune-tip">
                    <div class="ob-kicker">TIP</div>
                    <h2 class="ob-title">검색 결과가 내 느낌과 다르다면</h2>
                    <p class="ob-text">같은 '차가운'이라도 사람마다 떠올리는 이미지가 달라요. 이 검색은 내 감각에 맞춰져 있지만,
                    처음에는 어긋날 수 있어요.</p>
                    <ol class="ob-list">
                        <li>느낌 단어로 검색하면 검색창 아래에 <b>'결과 다듬기'</b>가 나와요</li>
                        <li>누르면 그 단어로 이미지 몇 장을 보여줘요. 그 느낌인 것만 골라요 (1분 정도)</li>
                        <li>고른 것과 안 고른 것을 함께 배워서, 검색 결과가 바로 내 감각 쪽으로 바뀌어요</li>
                    </ol>
                    <p class="ob-text ob-muted">할 때마다 이미 답한 이미지는 다시 묻지 않고 새로운 이미지로 물어봐요. 많이 할수록 정확해져요.</p>
                    <div class="ob-actions">
                        <button type="button" class="ob-btn ob-btn-primary" data-action="close-tip">알겠어요</button>
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
            if (action === 'connect-pinterest') connectPinterest();
            if (action === 'close-tuned' || action === 'close-tip') close(false);
            if (action === 'sync-retry') runPinterestSync();
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

    // ── Pinterest 계정 연결 (API) ───────────────────────────────

    /** 서버에 Pinterest 앱 키가 없으면(승인 전) 연결 버튼을 숨기고 ZIP 가져오기를 기본으로 */
    async function applyPinterestAvailability() {
        let ready = false;
        try { ready = !!(await (await fetch('/api/status')).json()).hasPinterestOAuth; } catch (e) { /* 모르면 ZIP으로 */ }
        root.querySelector('[data-action="connect-pinterest"]').classList.toggle('hidden', !ready);
        const zip = root.querySelector('[data-zip-path]');
        zip.classList.toggle('ob-btn', !ready);
        zip.classList.toggle('ob-btn-primary', !ready);
        zip.classList.toggle('ob-text-btn', ready);
        zip.textContent = ready ? 'Pinterest 데이터 파일(ZIP)로 가져오기' : '시작하기 →';
        root.querySelector('[data-welcome-hint]').textContent = ready
            ? '먼저 내 핀을 가져와야 해요. Pinterest 계정을 연결하면 바로 가져와요.'
            : '먼저 내 핀을 가져와야 해요. 3단계면 끝나요.';
    }

    /** Pinterest 동의 화면으로 갔다가 /index.html?pinterest=connected 로 돌아온다 (landing-auth.js → afterPinterestConnect) */
    async function connectPinterest() {
        const status = root.querySelector('[data-welcome-status]');
        status.classList.remove('error');
        status.textContent = 'Pinterest로 이동하는 중...';
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            const response = await fetch('/auth/pinterest/start', { method: 'POST', headers: { Authorization: `Bearer ${session ? session.access_token : ''}` } });
            const data = await response.json();
            if (!response.ok || !data.url) throw new Error(data.error || response.status);
            window.location.href = data.url;
        } catch (err) {
            status.classList.add('error');
            status.textContent = `Pinterest 연결을 시작하지 못했어요: ${err.message}. ZIP 파일로도 가져올 수 있어요.`;
        }
    }

    /** 연결된 Pinterest에서 핀을 가져오고, 끝나면 "다 됐어요" 단계와 내 핀 분석으로 이어간다 */
    async function runPinterestSync() {
        show(STEPS.indexOf('sync'));
        const status = root.querySelector('[data-sync-status]');
        const retry = root.querySelector('[data-action="sync-retry"]');
        status.classList.remove('error');
        status.textContent = '보드와 핀을 읽는 중...';
        retry.classList.add('hidden');
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            const response = await fetch('/api/pinterest/sync', { method: 'POST', headers: { Authorization: `Bearer ${session ? session.access_token : ''}` } });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || response.status);
            if (data.busy) {
                status.textContent = '이미 가져오는 중이에요. 잠시 뒤 다시 시도해 주세요.';
                retry.classList.remove('hidden');
                return;
            }
            // 자동 동기화(pinterest-autosync.js)가 곧바로 또 돌지 않게, 방금 가져온 시각을 남긴다
            try { localStorage.setItem(`pinterest-last-sync-${me.id}`, String(Date.now())); } catch (e) { /* 무시 */ }
            try { localStorage.removeItem(`onboarding-snooze-${me.id}`); } catch (e) { /* 무시 */ }
            root.querySelector('[data-done-title]').textContent = data.inserted
                ? `Pinterest에서 핀 ${data.inserted.toLocaleString()}개를 가져왔어요!`
                : '새로 가져올 핀이 없어요 - 이미 다 들어와 있어요';
            show(STEPS.indexOf('done'));
            startAnalysis();
            if (onFinished) onFinished(data.inserted);
        } catch (err) {
            status.classList.add('error');
            status.textContent = `가져오지 못했어요: ${err.message}`;
            retry.classList.remove('hidden');
        }
    }

    /** Pinterest 동의 화면에서 돌아왔을 때 (index.html?pinterest=connected) - 바로 핀을 가져온다 */
    async function afterPinterestConnect(options = {}) {
        await open({ ...options, startAt: 'sync' });
        runPinterestSync();
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
        startAnalysis();
        if (onFinished) onFinished(inserted);
    }

    // ── 내 핀 분석 (pin-analyzer.js): 생김새를 숫자로 계산해 두면, 테스트에 나오지 않은 핀에도 내 감각이 적용된다 ──

    function setAnalysisStatus(text, isError = false) {
        root.querySelectorAll('[data-analysis-status]').forEach((el) => {
            el.textContent = text;
            el.classList.toggle('error', isError);
        });
    }

    /** 아직 분석 안 된 내 핀을 이 브라우저에서 분석한다 (이미 된 핀은 건너뛰고, 창을 닫으면 다음에 이어서) */
    function startAnalysis() {
        if (!window.PinAnalyzer || PinAnalyzer.isRunning()) return;
        PinAnalyzer.analyzeMine({
            onProgress: ({ phase, done, total, failed }) => {
                if (phase === 'check') setAnalysisStatus('내 핀 분석 준비 중...');
                else if (phase === 'model') setAnalysisStatus(`내 핀 ${total.toLocaleString()}개를 분석하려고 이미지 모델을 불러오는 중... (처음 한 번만 시간이 걸려요)`);
                else if (phase === 'analyze') setAnalysisStatus(`내 핀 분석 중 ${done.toLocaleString()} / ${total.toLocaleString()} - 이 창을 열어 두면 계속 진행돼요`);
                else setAnalysisStatus(total ? `분석 완료 - 테스트에 나오지 않은 핀에도 내 감각이 적용돼요${failed ? ` (이미지를 못 읽은 핀 ${failed}개 제외)` : ''}` : '');
            }
        }).catch((err) => {
            console.warn('내 핀 분석 실패:', err);
            setAnalysisStatus(`내 핀 분석을 하지 못했어요: ${err.message}. 테스트는 그대로 할 수 있어요.`, true);
        });
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

    async function startTaste(presetWords = null) {
        me = me || await loadMe();
        startAnalysis();
        taste.tuning = !!(presetWords && presetWords.length);
        taste.words = [];
        renderSelectedWords();
        show(STEPS.indexOf('taste-words'));
        setTasteStatus('');
        try {
            if (!taste.vocab.length) {
                const data = await (await fetch('/api/search/vocab')).json();
                taste.vocab = (data.keywords || []).map((k) => k.ko);
                taste.testOrder = data.testOrder || [];
            }
            shuffleSuggestions();
            // 내 핀 (가져온 직후라도 바로 보이도록 서버 캐시를 거치지 않고 직접 읽는다)
            const { data, error } = await supabaseClient.from('pins')
                .select('id, image, custom_tags').eq('owner_id', me.id).neq('image', '').limit(2000);
            if (error) throw error;
            taste.pins = (data || []).filter((p) => p.image).map((p) => ({ id: p.id, image: p.image, customTags: p.custom_tags || [] }));
            if (taste.pins.length < 4) setTasteStatus('핀이 너무 적어요. 먼저 핀을 가져와 주세요.', true);
            else if (taste.tuning) {
                taste.words = presetWords.slice(0, MAX_WORDS);
                beginRounds();
            }
        } catch (err) {
            setTasteStatus(`내 핀을 불러오지 못했어요: ${err.message}`, true);
        }
    }

    /**
     * 추천 단어: 사람마다 판단이 가장 많이 갈리는 단어들은 항상 보여주고(그 답이 검색 정확도를 가장 많이 올린다),
     * 나머지 자리는 그다음으로 유익한 단어들 중에서 돌아가며 보여준다.
     */
    function shuffleSuggestions() {
        const order = taste.testOrder.length ? taste.testOrder : shuffle(taste.vocab);
        const fixed = order.slice(0, FIXED_SUGGESTIONS);
        taste.suggestions = [...fixed, ...shuffle(order.slice(FIXED_SUGGESTIONS)).slice(0, SUGGESTION_COUNT - fixed.length)];
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
        root.querySelector('[data-action="taste-begin"]').disabled = taste.words.length < MIN_WORDS || taste.pins.length < 4;
        root.querySelector('[data-action="taste-begin"]').textContent = taste.words.length >= MIN_WORDS
            ? `${taste.words.length}개 단어로 시작 →` : `${MIN_WORDS - taste.words.length}개 더 골라요`;
    }

    /**
     * 단어마다 보여줄 내 핀 정하기.
     * 분석된 핀이 충분하면 서버가 서로 최대한 다른 사진들로 고른다 (무작위보다 답 하나에서 얻는 정보가 많다).
     * 아니면 무작위로.
     */
    async function beginRounds() {
        const button = root.querySelector('[data-action="taste-begin"]');
        button.disabled = true;
        let chosenByServer = null;
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            const response = await fetch('/api/taste/rounds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session ? session.access_token : ''}` },
                body: JSON.stringify({ words: taste.words, perWord: ROUND_SIZE })
            });
            const data = await response.json();
            if (response.ok && data.rounds && data.rounds.length === taste.words.length) {
                chosenByServer = new Map(data.rounds.map((r) => [r.word, r.pins]));
            }
        } catch (err) {
            console.warn('테스트 사진을 서버에서 고르지 못해 무작위로 고릅니다:', err);
        }
        button.disabled = false;

        const byId = new Map(taste.pins.map((p) => [p.id, p]));
        // 단어마다 서로 다른 핀을 보여준다 (핀이 모자라면 겹칠 수 있다)
        let pool = shuffle(taste.pins);
        taste.rounds = taste.words.map((word) => {
            // 다시 하는 경우: 전에 이 단어로 고른 핀 몇 장은 다시 보여준다 (안 고르면 그 단어가 빠진다)
            const previous = shuffle(taste.pins.filter((p) => p.customTags.includes(word))).slice(0, RECHECK_PER_WORD);
            const fresh = [];
            const serverPicks = (chosenByServer && chosenByServer.get(word)) || [];
            serverPicks.map((id) => byId.get(id)).forEach((pin) => {
                if (pin && fresh.length < ROUND_SIZE - previous.length && !previous.includes(pin)) fresh.push(pin);
            });
            while (fresh.length < ROUND_SIZE - previous.length) {
                if (!pool.length) pool = shuffle(taste.pins);
                const pin = pool.pop();
                if (!previous.includes(pin) && !fresh.includes(pin)) fresh.push(pin);
                if (fresh.length + previous.length >= taste.pins.length) break;
            }
            const pins = shuffle([...previous, ...fresh]);
            const preselected = new Set(previous.map((p) => p.id));
            return { word, stage: 'explore', pins, chosen: new Set(preselected), preselected };
        });
        taste.roundIndex = 0;
        renderRound();
        show(STEPS.indexOf('taste-round'));
    }

    function renderRound() {
        const round = taste.rounds[taste.roundIndex];
        const wordNo = taste.words.indexOf(round.word) + 1;
        root.querySelector('[data-round-kicker]').textContent = `WORD ${wordNo} / ${taste.words.length}${round.stage === 'confirm' ? ' · 확인' : ''}`;
        root.querySelector('[data-round-title]').textContent = round.stage === 'confirm'
            ? `이 중에서도 '${round.word}' 느낌인 건?`
            : `'${round.word}' 느낌인 이미지를 골라 보세요`;
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
        const last = taste.roundIndex === taste.rounds.length - 1 && round.stage === 'confirm';
        root.querySelector('[data-action="taste-next"]').textContent = last ? '완료 →' : '다음 →';
    }

    function renderPickCount() {
        const round = taste.rounds[taste.roundIndex];
        root.querySelector('[data-pick-count]').textContent = `${round.chosen.size}장 고름`;
    }

    /** 확인 라운드 사진: 첫 라운드에서 고른 사진과 닮은 내 핀 (분석 전이면 아직 안 보여준 핀 중 무작위) */
    async function confirmPinsFor(round) {
        const shownEverywhere = new Set(taste.rounds.flatMap((r) => r.pins.map((p) => p.id)));
        const byId = new Map(taste.pins.map((p) => [p.id, p]));
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            const response = await fetch('/api/taste/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session ? session.access_token : ''}` },
                body: JSON.stringify({ word: round.word, picked: [...round.chosen], shown: [...shownEverywhere], count: CONFIRM_SIZE })
            });
            const data = await response.json();
            const pins = (data.pins || []).map((id) => byId.get(id)).filter(Boolean);
            if (response.ok && pins.length) return pins;
        } catch (err) {
            console.warn('확인 라운드 사진을 서버에서 고르지 못해 무작위로 고릅니다:', err);
        }
        return shuffle(taste.pins.filter((p) => !shownEverywhere.has(p.id))).slice(0, CONFIRM_SIZE);
    }

    async function nextRound() {
        const round = taste.rounds[taste.roundIndex];
        if (round.stage === 'explore' && !round.confirmAdded) {
            round.confirmAdded = true;
            const button = root.querySelector('[data-action="taste-next"]');
            button.disabled = true;
            const confirm = await confirmPinsFor(round);
            button.disabled = false;
            if (confirm.length) {
                taste.rounds.splice(taste.roundIndex + 1, 0, { word: round.word, stage: 'confirm', pins: confirm, chosen: new Set(), preselected: new Set() });
            }
        }
        if (taste.roundIndex < taste.rounds.length - 1) {
            taste.roundIndex += 1;
            renderRound();
            root.querySelector('.ob-card').scrollTop = 0;
            return;
        }
        finishTaste();
    }

    /**
     * 테스트 기록을 남긴다: 단어마다 보여준 핀을 고르면 2(맞아), 안 고르면 0(아니야).
     * 안 고른 핀까지 있어야 서버가 "이 사람의 경계"를 학습해서, 테스트에 안 나온 핀에도 그 감각을 적용할 수 있다.
     * 기록할 곳(taste_marks)이 아직 없으면(DB 설정 전) 키워드 태그만 저장하고 넘어간다.
     */
    async function saveTasteMarks() {
        const rows = taste.rounds.flatMap((round) => round.pins.map((pin) => ({
            owner_id: me.id,
            word: round.word,
            pin_id: pin.id,
            value: round.chosen.has(pin.id) ? 2 : 0,
            updated_at: new Date().toISOString()
        })));
        if (!rows.length) return;
        const { error } = await supabaseClient.from('taste_marks').upsert(rows, { onConflict: 'owner_id,word,pin_id' });
        if (error) console.warn('감각 테스트 기록을 남기지 못했어요 (키워드 태그는 저장됨):', error.message);
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
            await saveTasteMarks();
            status.textContent = '저장했어요';
            if (onTasteSaved) onTasteSaved();
        } catch (err) {
            status.classList.add('error');
            status.textContent = `저장하지 못했어요: ${err.message}`;
        }

        root.querySelector('[data-action="close-tuned"]').classList.toggle('hidden', !taste.tuning);
        root.querySelector('[data-link="search"]').classList.toggle('hidden', !!taste.tuning);
        const firstWord = (taste.rounds.find((r) => r.chosen.size) || taste.rounds[0]).word;
        const search = root.querySelector('[data-link="search"]');
        search.href = `gallery.html?user=${encodeURIComponent(me.username)}&q=${encodeURIComponent(firstWord)}`;
        search.textContent = `터널에서 '${firstWord}' 검색해 보기 →`;
    }

    function renderResult() {
        const box = root.querySelector('[data-taste-result]');
        box.replaceChildren();
        // 단어마다 탐색 + 확인 두 라운드를 합쳐서 한 줄로
        taste.words.forEach((word) => {
            const rounds = taste.rounds.filter((r) => r.word === word);
            const shown = rounds.flatMap((r) => r.pins);
            const chosen = rounds.flatMap((r) => r.pins.filter((p) => r.chosen.has(p.id)));
            const row = document.createElement('div');
            row.className = 'ob-result-row';
            const head = document.createElement('div');
            head.className = 'ob-result-head';
            head.innerHTML = '<b></b><span></span>';
            head.querySelector('b').textContent = word;
            head.querySelector('span').textContent = chosen.length ? `${shown.length}장 중 ${chosen.length}장` : '고른 이미지 없음';
            const thumbs = document.createElement('div');
            thumbs.className = 'ob-result-thumbs';
            chosen.slice(0, 6).forEach((pin) => {
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
    /**
     * startAt: 'welcome' | 'taste' | 'sync' | 'tune-tip' … · words: 'taste'로 열 때 단어를 정해 두면 단어 고르기 없이
     * 바로 그 단어로 묻는다 (터널 검색창의 "결과 다듬기")
     */
    async function open({ startAt = 'welcome', onDone = null, onTaste = null, words = null } = {}) {
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
        applyPinterestAvailability();
        root.classList.remove('hidden');
        if (startAt === 'taste') startTaste(words);
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

    /** 결과 다듬기 안내 (터널에서 느낌 단어로 처음 검색했을 때 한 번) */
    function showTuneTip() {
        return open({ startAt: 'tune-tip' });
    }

    return { open, maybeAutoOpen, afterPinterestConnect, showTuneTip };
})();
