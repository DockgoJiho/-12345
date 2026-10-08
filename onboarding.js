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

    const STEPS = ['welcome', 'request', 'download', 'upload', 'done'];

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
                    "차가운", "사람 없는"처럼 느낌으로 찾고, 다른 사람의 터널도 구경할 수 있어요.</p>
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
                    <div class="ob-mail">
                        <div class="ob-mail-from">Pinterest</div>
                        <div class="ob-mail-subject">Pinterest 데이터가 준비되었습니다</div>
                        <div class="ob-mail-button">다운로드</div>
                    </div>
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
                    <div class="ob-kicker">COMPLETE</div>
                    <h2 class="ob-title" data-done-title>다 됐어요!</h2>
                    <p class="ob-text">이제 내 터널에 들어가 보세요. 개인 페이지에서 프로필 사진과 소개도 꾸밀 수 있어요.</p>
                    <div class="ob-actions">
                        <a class="ob-btn ob-btn-ghost" data-link="profile" href="#">개인 페이지 꾸미기</a>
                        <a class="ob-btn ob-btn-primary" data-link="tunnel" href="#">내 터널로 들어가기 →</a>
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

    // ── 공개 함수 ───────────────────────────────────────────

    async function loadMe() {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return null;
        const { data } = await supabaseClient.from('profiles').select('id, username, username_is_placeholder').eq('id', session.user.id).maybeSingle();
        return data || null;
    }

    /** 안내를 연다. startAt: 'welcome' | 'upload' 등. onDone(가져온 개수): 다 가져온 뒤 불린다 */
    async function open({ startAt = 'welcome', onDone = null } = {}) {
        if (!root) build();
        me = me || await loadMe();
        onFinished = onDone;
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
        show(STEPS.indexOf(startAt));
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
