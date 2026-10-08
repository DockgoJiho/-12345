/**
 * 메인 페이지의 로그인/회원가입/로그아웃 상태 관리, 사람 찾기, 로그인했을 때 보이는 팔로잉 목록.
 * supabase-client.js, profile-ui.js가 먼저 로드되어 있어야 한다.
 */

let currentUserId = null;
let currentUsername = null;
let followingListRequestId = 0;

// 사용자명: 언어 무관하게(한글/영문/숫자/이모지 등) 2~20자, 공백 없이. URL에 쓸 때는
// 항상 encodeURIComponent를 거치므로 어떤 문자가 들어와도 링크는 안전하다.
const USERNAME_PATTERN = /^[\p{L}\p{N}_]{2,20}$/u;

// ── DOM 참조 ──────────────────────────────────────────────
const authWidget = {
    loggedOut: document.getElementById('auth-logged-out'),
    loggedIn: document.getElementById('auth-logged-in'),
    loginBtn: document.getElementById('auth-login-btn'),
    logoutBtn: document.getElementById('auth-logout-btn'),
    myArchiveLink: document.getElementById('auth-my-archive'),
    usernameEl: document.getElementById('auth-username')
};

const authModal = document.getElementById('auth-modal');
const authModalClose = document.getElementById('auth-modal-close');
const authTabLogin = document.getElementById('auth-tab-login');
const authTabSignup = document.getElementById('auth-tab-signup');
const loginForm = document.getElementById('auth-login-form');
const signupForm = document.getElementById('auth-signup-form');
const loginError = document.getElementById('login-error');
const signupError = document.getElementById('signup-error');

const followingSection = document.getElementById('following-section');
const followingList = document.getElementById('following-list');

const oauthGoogleBtn = document.getElementById('oauth-google-btn');
const oauthKakaoBtn = document.getElementById('oauth-kakao-btn');

const usernameSetupModal = document.getElementById('username-setup-modal');
const usernameSetupForm = document.getElementById('username-setup-form');
const usernameSetupInput = document.getElementById('username-setup-input');
const usernameSetupError = document.getElementById('username-setup-error');

const pinterestConnectBtn = document.getElementById('pinterest-connect-btn');
const pinterestToast = document.getElementById('pinterest-toast');
let pinterestConnected = false;

// ── 모달 열기/닫기, 탭 전환 ──────────────────────────────────
function openAuthModal(tab = 'login') {
    authModal.classList.remove('hidden');
    switchAuthTab(tab);
}

function closeAuthModal() {
    authModal.classList.add('hidden');
    loginError.textContent = '';
    signupError.textContent = '';
}

function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    authTabLogin.classList.toggle('active', isLogin);
    authTabSignup.classList.toggle('active', !isLogin);
    loginForm.classList.toggle('hidden', !isLogin);
    signupForm.classList.toggle('hidden', isLogin);
}

authWidget.loginBtn.addEventListener('click', () => openAuthModal('login'));
authModalClose.addEventListener('click', closeAuthModal);
authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuthModal();
});
authTabLogin.addEventListener('click', () => switchAuthTab('login'));
authTabSignup.addEventListener('click', () => switchAuthTab('signup'));

// ── 로그인 ──────────────────────────────────────────────
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
        loginError.textContent = '로그인 실패: 이메일 또는 비밀번호를 확인해주세요.';
        return;
    }
    closeAuthModal();
    loginForm.reset();
});

// ── 회원가입 (사용자명 중복 체크 먼저) ──────────────────────────
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    signupError.textContent = '';

    const username = document.getElementById('signup-username').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;

    if (!USERNAME_PATTERN.test(username)) {
        signupError.textContent = '사용자명은 공백 없이 2~20자로 입력해주세요.';
        return;
    }

    // 트리거가 실패해서 계정만 만들어지고 프로필이 안 생기는 상황(중복 사용자명)을
    // 미리 막기 위해, 가입 시도 전에 먼저 확인한다.
    const { data: existing } = await supabaseClient
        .from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle();

    if (existing) {
        signupError.textContent = '이미 사용 중인 사용자명입니다.';
        return;
    }

    const { error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { username } }
    });

    if (error) {
        signupError.textContent = `회원가입 실패: ${error.message}`;
        return;
    }

    closeAuthModal();
    signupForm.reset();
});

// ── 소셜 로그인 (구글/카카오) ─────────────────────────────────
// 회원가입과 로그인이 하나의 흐름이다 - Supabase가 처음 오는 계정이면 자동으로
// 만들고, 이미 있으면 그냥 로그인시킨다. 페이지 전체가 제공자로 이동했다가
// 돌아오므로, 돌아온 뒤의 처리는 아래 onAuthStateChange가 그대로 담당한다.
oauthGoogleBtn.addEventListener('click', () => {
    supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/index.html' }
    });
});

oauthKakaoBtn.addEventListener('click', () => {
    supabaseClient.auth.signInWithOAuth({
        provider: 'kakao',
        options: { redirectTo: window.location.origin + '/index.html' }
    });
});

// ── 로그아웃 ──────────────────────────────────────────────
authWidget.logoutBtn.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
});

// ── 로그인 상태에 따라 화면 갱신 ──────────────────────────────
async function refreshAuthUI(session) {
    if (session && session.user) {
        currentUserId = session.user.id;

        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('username, username_is_placeholder')
            .eq('id', currentUserId)
            .maybeSingle();

        currentUsername = profile ? profile.username : null;

        authWidget.loggedOut.classList.add('hidden');
        authWidget.loggedIn.classList.remove('hidden');
        authWidget.usernameEl.textContent = currentUsername ? `@${currentUsername}` : '';
        authWidget.usernameEl.href = currentUsername ? ProfileUI.profileUrl(currentUsername) : '#';
        authWidget.myArchiveLink.href = currentUsername
            ? `gallery.html?user=${encodeURIComponent(currentUsername)}`
            : 'gallery.html';

        followingSection.classList.remove('hidden');
        loadFollowingList();
        refreshPinterestButton(session.access_token);

        // 구글/카카오로 처음 가입해서 임시 사용자명이 붙어 있으면, 실제로 쓸
        // 사용자명을 한 번 정하고 넘어가게 한다 (입력창엔 그 임시 사용자명을
        // 미리 채워둬서, 마음에 들면 그대로 저장만 해도 된다)
        if (profile && profile.username_is_placeholder) {
            usernameSetupError.textContent = '';
            usernameSetupInput.value = currentUsername || '';
            usernameSetupModal.classList.remove('hidden');
        } else {
            usernameSetupModal.classList.add('hidden');
            // 핀이 하나도 없으면 "내 핀 가져오기" 안내를 띄운다
            Onboarding.maybeAutoOpen();
        }
    } else {
        currentUserId = null;
        currentUsername = null;

        authWidget.loggedOut.classList.remove('hidden');
        authWidget.loggedIn.classList.add('hidden');
        followingSection.classList.add('hidden');
        usernameSetupModal.classList.add('hidden');
    }
}

// ── Pinterest 실계정 연동 ──────────────────────────────────────
function showPinterestToast(message, isError = false, duration = 4000) {
    pinterestToast.textContent = message;
    pinterestToast.classList.toggle('error', isError);
    pinterestToast.classList.remove('hidden');
    clearTimeout(showPinterestToast._timer);
    showPinterestToast._timer = setTimeout(() => {
        pinterestToast.classList.add('hidden');
    }, duration);
}

// Pinterest 공식 연동(API)은 심사가 끝나야 쓸 수 있다 - 서버에 앱 키가 없으면 아직 준비 중으로 표시한다
let pinterestOAuthReady = null;
async function checkPinterestOAuthReady() {
    if (pinterestOAuthReady !== null) return pinterestOAuthReady;
    try {
        const data = await (await fetch('/api/status')).json();
        pinterestOAuthReady = !!data.hasPinterestOAuth;
    } catch (err) {
        pinterestOAuthReady = false;
    }
    return pinterestOAuthReady;
}

async function refreshPinterestButton(accessToken) {
    try {
        const res = await fetch('/api/pinterest/status', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await res.json();
        pinterestConnected = !!data.connected;
    } catch (err) {
        pinterestConnected = false;
    }
    const ready = await checkPinterestOAuthReady();
    pinterestConnectBtn.textContent = pinterestConnected ? 'Sync Pinterest' : (ready ? 'Connect Pinterest' : 'Connect Pinterest (준비 중)');
}

pinterestConnectBtn.addEventListener('click', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    const accessToken = session.access_token;

    if (!pinterestConnected && !(await checkPinterestOAuthReady())) {
        showPinterestToast('Pinterest 계정 바로 연동은 아직 준비 중이에요 (Pinterest 심사 대기). 지금은 개인 페이지의 "핀 가져오기"로 Pinterest 데이터 ZIP을 올려 가져올 수 있어요.', false, 7000);
        return;
    }

    if (!pinterestConnected) {
        pinterestConnectBtn.disabled = true;
        try {
            const res = await fetch('/auth/pinterest/start', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const data = await res.json();
            if (!res.ok) {
                showPinterestToast(data.error || 'Pinterest 연동을 시작하지 못했습니다', true);
                return;
            }
            // 전체 페이지 이동 - Pinterest 인증 화면으로 나갔다가 콜백으로 돌아온다
            window.location.href = data.url;
        } finally {
            pinterestConnectBtn.disabled = false;
        }
        return;
    }

    pinterestConnectBtn.disabled = true;
    pinterestConnectBtn.textContent = '동기화 중...';
    try {
        const res = await fetch('/api/pinterest/sync', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await res.json();
        if (!res.ok) {
            showPinterestToast(data.error || '동기화에 실패했습니다', true);
        } else {
            showPinterestToast(`${data.inserted}개의 새 핀을 가져왔습니다 (총 ${data.fetched}개 확인)`);
        }
    } catch (err) {
        showPinterestToast('동기화에 실패했습니다', true);
    } finally {
        pinterestConnectBtn.disabled = false;
        pinterestConnectBtn.textContent = pinterestConnected ? 'Sync Pinterest' : 'Connect Pinterest';
    }
});

// Pinterest 인증 화면에 다녀온 직후(서버가 ?pinterest=connected|error로 돌려보낸다)
(function handlePinterestRedirectResult() {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('pinterest');
    if (!result) return;

    if (result === 'connected') {
        showPinterestToast('Pinterest 계정이 연동되었습니다. 다시 눌러서 동기화해보세요.');
    } else if (result === 'error') {
        showPinterestToast('Pinterest 연동에 실패했습니다. 다시 시도해주세요.', true);
    }

    params.delete('pinterest');
    const cleanedUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
    window.history.replaceState({}, '', cleanedUrl);
})();

// ── 소셜 로그인 첫 가입자의 사용자명 정하기 ──────────────────────
usernameSetupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    usernameSetupError.textContent = '';

    const desired = usernameSetupInput.value.trim();
    if (!USERNAME_PATTERN.test(desired)) {
        usernameSetupError.textContent = '사용자명은 공백 없이 2~20자로 입력해주세요.';
        return;
    }

    if (desired !== currentUsername) {
        const { data: existing } = await supabaseClient
            .from('profiles')
            .select('id')
            .eq('username', desired)
            .maybeSingle();

        if (existing && existing.id !== currentUserId) {
            usernameSetupError.textContent = '이미 사용 중인 사용자명입니다.';
            return;
        }
    }

    const { error } = await supabaseClient
        .from('profiles')
        .update({ username: desired, display_name: desired, username_is_placeholder: false })
        .eq('id', currentUserId);

    if (error) {
        usernameSetupError.textContent = `저장 실패: ${error.message}`;
        return;
    }

    usernameSetupModal.classList.add('hidden');
    refreshAuthUI({ user: { id: currentUserId } });
});

supabaseClient.auth.getSession().then(({ data }) => refreshAuthUI(data.session));
supabaseClient.auth.onAuthStateChange((_event, session) => refreshAuthUI(session));

// ── 팔로잉 목록 ──────────────────────────────────────────────
async function loadFollowingList() {
    // onAuthStateChange는 짧은 시간에 여러 번 연달아 발생할 수 있어서(예: INITIAL_SESSION
    // 직후 SIGNED_IN), 이 함수가 겹쳐 호출될 수 있다. 나중에 시작된 호출만 결과를 반영하도록
    // 요청 ID로 가려서, 먼저 시작했지만 늦게 끝난 응답이 뒤늦게 목록을 덮어쓰는 것을 막는다.
    const requestId = ++followingListRequestId;

    if (!currentUserId) {
        followingList.innerHTML = '';
        return;
    }

    let people = [];
    try {
        people = await ProfileUI.following(currentUserId);
    } catch (err) {
        console.warn('팔로잉 목록 실패:', err);
    }
    if (requestId !== followingListRequestId) return;

    followingList.replaceChildren();
    if (!people.length) {
        followingList.innerHTML = '<div class="following-empty">아직 팔로우한 사람이 없습니다 - 위에서 사람을 찾아 개인 페이지에서 팔로우하세요</div>';
        return;
    }
    people.forEach((person) => followingList.appendChild(ProfileUI.row(person)));
}

// ── 사람 찾기: 칠 때마다 사용자가 뜨고, 줄을 누르면 개인 페이지 / TUNNEL을 누르면 바로 터널로 ──
const peopleInput = document.getElementById('people-search-input');
const peopleResults = document.getElementById('people-results');
let peopleSearchTimer = null;
let peopleRequestId = 0;

function closePeopleResults() {
    peopleResults.classList.add('hidden');
}

async function runPeopleSearch() {
    const query = peopleInput.value;
    const requestId = ++peopleRequestId;
    if (!query.trim()) {
        closePeopleResults();
        return;
    }
    let people = [];
    try {
        people = await ProfileUI.searchUsers(query);
    } catch (err) {
        console.warn('사용자 검색 실패:', err);
    }
    if (requestId !== peopleRequestId) return;

    peopleResults.replaceChildren();
    if (!people.length) {
        peopleResults.innerHTML = '<div class="following-empty">일치하는 사용자가 없습니다</div>';
    } else {
        people.forEach((person) => peopleResults.appendChild(ProfileUI.row(person)));
    }
    peopleResults.classList.remove('hidden');
}

peopleInput.addEventListener('input', () => {
    clearTimeout(peopleSearchTimer);
    peopleSearchTimer = setTimeout(runPeopleSearch, 120);
});
peopleInput.addEventListener('focus', () => {
    if (peopleInput.value.trim()) runPeopleSearch();
});
peopleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePeopleResults(); peopleInput.blur(); }
    // Enter: 맨 위 사람의 개인 페이지로
    if (e.key === 'Enter' && !e.isComposing && peopleResults.querySelector('.pu-row')) {
        peopleResults.querySelector('.pu-row').click();
    }
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.people-search')) closePeopleResults();
});

// 처음 가입했을 때 뜨는 안내를 그냥 다시 보고 싶을 때 (index.html?onboarding=1) - 핀이 있어도 연다
if (new URLSearchParams(window.location.search).get('onboarding') === '1') {
    Onboarding.open();
}

// 개인 페이지에서 로그인 없이 팔로우를 누르면 여기로 온다 (index.html?login=1)
if (new URLSearchParams(window.location.search).get('login') === '1') {
    supabaseClient.auth.getSession().then(({ data }) => {
        if (!data.session) openAuthModal('login');
    });
}
