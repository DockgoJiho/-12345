/**
 * 개인 페이지 (profile.html?user=사용자명).
 * 누구나 볼 수 있다: 프로필(사진·이름·소개·링크), 핀/팔로워/팔로잉 수와 목록, 터널 바로가기, 핀 미리보기.
 * 로그인한 사람: 다른 사람이면 팔로우 버튼, 본인이면 프로필 편집.
 */
const PREVIEW_PIN_LIMIT = 48;
const AVATAR_SIZE = 320;

const $ = (id) => document.getElementById(id);
const els = {
    status: $('pf-status'),
    profile: $('pf-profile'),
    bannerName: $('pf-banner-name'),
    avatar: $('pf-avatar'),
    display: $('pf-display'),
    handle: $('pf-handle'),
    bio: $('pf-bio'),
    link: $('pf-link'),
    pinCount: $('pf-pin-count'),
    followerCount: $('pf-follower-count'),
    followingCount: $('pf-following-count'),
    followersBtn: $('pf-followers-btn'),
    followingBtn: $('pf-following-btn'),
    enterTunnel: $('pf-enter-tunnel'),
    followBtn: $('pf-follow-btn'),
    editBtn: $('pf-edit-btn'),
    importBtn: $('pf-import-btn'),
    tasteBtn: $('pf-taste-btn'),
    keywordsSection: $('pf-keywords-section'),
    keywords: $('pf-keywords'),
    myPage: $('pf-my-page'),
    pinsSection: $('pf-pins-section'),
    pins: $('pf-pins'),
    listModal: $('pf-list-modal'),
    list: $('pf-list'),
    editModal: $('pf-edit-modal'),
    editForm: $('pf-edit-form'),
    editAvatar: $('pf-edit-avatar'),
    avatarInput: $('pf-avatar-input'),
    avatarRemove: $('pf-avatar-remove'),
    editDisplay: $('pf-edit-display'),
    editBio: $('pf-edit-bio'),
    bioCount: $('pf-bio-count'),
    editLink: $('pf-edit-link'),
    editSave: $('pf-edit-save'),
    editError: $('pf-edit-error')
};

const state = {
    me: null,          // { id, username } 로그인했으면
    profile: null,     // 보고 있는 사람의 profiles 행
    isFollowing: false,
    followerCount: 0,
    pendingAvatar: undefined // 편집 중 고른 새 사진(Blob), null이면 지우기, undefined면 그대로
};

// ── 링크: 사람들이 "instagram.com/..."처럼 앞부분 없이 쓰는 경우가 많아서 https://를 붙여 준다 ──
function normalizeLink(raw) {
    const value = (raw || '').trim();
    if (!value) return '';
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function linkLabel(url) {
    try {
        const u = new URL(url);
        return (u.host.replace(/^www\./, '') + u.pathname.replace(/\/$/, '')).slice(0, 60);
    } catch (e) {
        return url;
    }
}

// 작은 미리보기: 내 서버에 있는 이미지는 images/t/ 썸네일, 내보내기로 가져온 Pinterest 이미지는 236px 크기
function thumbUrl(image) {
    if (image.startsWith('/images/') && !image.startsWith('/images/t/')) {
        return image.replace(/^\/images\/([^/]+)\.[^.]+$/, '/images/t/$1.webp');
    }
    if (/^https:\/\/i\.pinimg\.com\/(736x|originals)\//.test(image)) {
        return image.replace(/^https:\/\/i\.pinimg\.com\/(736x|originals)\//, 'https://i.pinimg.com/236x/');
    }
    return null;
}

// ── 불러오기 ──────────────────────────────────────────────

async function loadMe() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;
    const { data } = await supabaseClient.from('profiles').select('id, username').eq('id', session.user.id).maybeSingle();
    return data || null;
}

async function loadProfile(username) {
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('username', username).maybeSingle();
    if (error) throw error;
    return data;
}

async function init() {
    state.me = await loadMe();
    let username = new URLSearchParams(window.location.search).get('user');

    // 주소에 사용자가 없으면: 로그인했으면 내 페이지, 아니면 메인으로
    if (!username) {
        if (!state.me) { window.location.replace('index.html'); return; }
        username = state.me.username;
        history.replaceState(null, '', ProfileUI.profileUrl(username));
    }

    if (state.me) {
        els.myPage.href = ProfileUI.profileUrl(state.me.username);
        els.myPage.classList.toggle('hidden', state.me.username === username);
    }

    try {
        state.profile = await loadProfile(username);
    } catch (err) {
        els.status.textContent = '프로필을 불러오지 못했습니다';
        return;
    }
    if (!state.profile) {
        els.status.textContent = `@${username} 사용자를 찾을 수 없습니다`;
        return;
    }

    document.title = `${state.profile.display_name || username} · Pinterest Archive`;
    renderProfile();
    els.status.classList.add('hidden');
    els.profile.classList.remove('hidden');

    loadCounts();
    loadPins();
    loadKeywords();
    if (isOwn()) Onboarding.maybeAutoOpen({ onDone: afterImport, onTaste: loadKeywords });
}

// 핀을 가져오면 숫자와 미리보기를 새로 불러온다
function afterImport(inserted) {
    if (inserted) loadPins();
}

els.importBtn.addEventListener('click', () => Onboarding.open({ onDone: afterImport, onTaste: loadKeywords }));
els.tasteBtn.addEventListener('click', () => Onboarding.open({ startAt: 'taste', onTaste: loadKeywords }));

/** 이 사람 핀에 붙은 키워드(감각 테스트 결과 + 직접 붙인 것)를 많이 쓴 순서로 */
async function loadKeywords() {
    const { data, error } = await supabaseClient.from('pins')
        .select('custom_tags').eq('owner_id', state.profile.id).neq('custom_tags', '{}').limit(5000);
    const counts = new Map();
    (error ? [] : data || []).forEach((row) => (row.custom_tags || []).forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
    }));
    const sorted = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40);

    els.keywords.replaceChildren();
    if (!sorted.length) {
        els.keywordsSection.classList.toggle('hidden', !isOwn());
        if (isOwn()) {
            const empty = document.createElement('div');
            empty.className = 'pf-empty';
            empty.textContent = '아직 키워드가 없어요. "감각 테스트"로 내 감각을 키워드로 만들어 보세요.';
            els.keywords.appendChild(empty);
        }
        return;
    }
    els.keywordsSection.classList.remove('hidden');
    sorted.forEach(([tag, count]) => {
        const chip = document.createElement('a');
        chip.className = 'pf-keyword';
        chip.href = `${ProfileUI.tunnelUrl(state.profile.username)}&q=${encodeURIComponent(tag)}`;
        chip.innerHTML = '<span></span><em></em>';
        chip.querySelector('span').textContent = tag;
        chip.querySelector('em').textContent = count;
        els.keywords.appendChild(chip);
    });
}

const isOwn = () => !!(state.me && state.profile && state.me.id === state.profile.id);

function renderProfile() {
    const p = state.profile;
    const name = p.display_name || p.username;
    els.bannerName.textContent = name;
    els.avatar.replaceChildren(ProfileUI.avatar(p, 132));
    els.display.textContent = name;
    els.handle.textContent = `@${p.username}`;
    els.bio.textContent = p.bio || '';

    const link = normalizeLink(p.link_url);
    els.link.classList.toggle('hidden', !link);
    if (link) {
        els.link.href = link;
        els.link.textContent = `↗ ${linkLabel(link)}`;
    }

    els.enterTunnel.href = ProfileUI.tunnelUrl(p.username);
    els.editBtn.classList.toggle('hidden', !isOwn());
    els.importBtn.classList.toggle('hidden', !isOwn());
    els.tasteBtn.classList.toggle('hidden', !isOwn());
    els.followBtn.classList.toggle('hidden', isOwn());
    renderFollowButton();
}

async function loadCounts() {
    const id = state.profile.id;
    const [followers, following, mine] = await Promise.all([
        supabaseClient.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followee_id', id),
        supabaseClient.from('follows').select('followee_id', { count: 'exact', head: true }).eq('follower_id', id),
        state.me && !isOwn()
            ? supabaseClient.from('follows').select('follower_id').eq('follower_id', state.me.id).eq('followee_id', id).maybeSingle()
            : Promise.resolve({ data: null })
    ]);
    state.followerCount = followers.count || 0;
    els.followerCount.textContent = state.followerCount;
    els.followingCount.textContent = following.count || 0;
    state.isFollowing = !!mine.data;
    renderFollowButton();
}

async function loadPins() {
    try {
        const data = await (await fetch(`/api/pins?user=${encodeURIComponent(state.profile.username)}`)).json();
        els.pinCount.textContent = data.total ?? (data.pins || []).length;
        renderPins(data.pins || []);
    } catch (err) {
        els.pinCount.textContent = '–';
    }
}

function renderPins(pins) {
    els.pinsSection.classList.remove('hidden');
    els.pins.replaceChildren();
    if (!pins.length) {
        const empty = document.createElement('div');
        empty.className = 'pf-empty';
        empty.textContent = isOwn() ? '아직 가져온 핀이 없어요. 위의 "핀 가져오기"를 눌러 Pinterest 핀을 가져오세요.' : '아직 저장된 핀이 없습니다.';
        els.pins.appendChild(empty);
        return;
    }
    pins.slice(0, PREVIEW_PIN_LIMIT).forEach((pin) => {
        if (!pin.image) return;
        const a = document.createElement('a');
        a.className = 'pf-pin';
        // 누르면 그 핀이 열린 채로 이 사람의 터널에 들어간다
        a.href = `${ProfileUI.tunnelUrl(state.profile.username)}&pin=${encodeURIComponent(pin.id)}`;
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = pin.title && pin.title !== '제목 없음' ? pin.title : '';
        const small = thumbUrl(pin.image);
        img.src = small || pin.image;
        if (small) img.onerror = () => { img.onerror = null; img.src = pin.image; };
        a.appendChild(img);
        els.pins.appendChild(a);
    });
}

// ── 팔로우 ────────────────────────────────────────────────

function renderFollowButton() {
    if (isOwn()) return;
    els.followBtn.textContent = state.isFollowing ? 'FOLLOWING' : 'FOLLOW';
    els.followBtn.classList.toggle('following', state.isFollowing);
}

els.followBtn.addEventListener('click', async () => {
    // 로그인 안 했으면 메인(로그인 창 있는 곳)으로
    if (!state.me) { window.location.href = 'index.html?login=1'; return; }
    els.followBtn.disabled = true;
    try {
        if (state.isFollowing) {
            const { error } = await supabaseClient.from('follows').delete()
                .eq('follower_id', state.me.id).eq('followee_id', state.profile.id);
            if (error) throw error;
            state.isFollowing = false;
            state.followerCount = Math.max(0, state.followerCount - 1);
        } else {
            const { error } = await supabaseClient.from('follows').insert({ follower_id: state.me.id, followee_id: state.profile.id });
            if (error && error.code !== '23505') throw error;
            state.isFollowing = true;
            state.followerCount += 1;
        }
        els.followerCount.textContent = state.followerCount;
        renderFollowButton();
    } catch (err) {
        console.warn('팔로우 변경 실패:', err);
    } finally {
        els.followBtn.disabled = false;
    }
});

// ── 팔로워 / 팔로잉 목록 ───────────────────────────────────

let listRequestId = 0;
async function openList(tab) {
    els.listModal.classList.remove('hidden');
    els.listModal.querySelectorAll('.pf-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    const requestId = ++listRequestId;
    els.list.innerHTML = '<div class="pf-empty">LOADING</div>';
    try {
        const people = tab === 'followers'
            ? await ProfileUI.followers(state.profile.id)
            : await ProfileUI.following(state.profile.id);
        if (requestId !== listRequestId) return;
        els.list.replaceChildren();
        if (!people.length) {
            els.list.innerHTML = `<div class="pf-empty">${tab === 'followers' ? '아직 팔로워가 없습니다' : '아직 팔로우한 사람이 없습니다'}</div>`;
            return;
        }
        people.forEach((person) => els.list.appendChild(ProfileUI.row(person)));
    } catch (err) {
        if (requestId === listRequestId) els.list.innerHTML = '<div class="pf-empty">목록을 불러오지 못했습니다</div>';
    }
}

els.followersBtn.addEventListener('click', () => openList('followers'));
els.followingBtn.addEventListener('click', () => openList('following'));
els.listModal.querySelectorAll('.pf-tab').forEach((t) => t.addEventListener('click', () => openList(t.dataset.tab)));

// 모달: 바깥/× 클릭, Esc로 닫기
document.querySelectorAll('.pf-modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.hasAttribute('data-close')) modal.classList.add('hidden');
    });
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.pf-modal').forEach((m) => m.classList.add('hidden'));
});

// ── 프로필 편집 (본인) ─────────────────────────────────────

function renderEditAvatar() {
    const p = state.profile;
    let preview = p;
    if (state.pendingAvatar === null) preview = { ...p, avatar_url: null };
    else if (state.pendingAvatar) preview = { ...p, avatar_url: URL.createObjectURL(state.pendingAvatar) };
    els.editAvatar.replaceChildren(ProfileUI.avatar(preview, 64));
    els.avatarRemove.classList.toggle('hidden', !preview.avatar_url);
}

els.editBtn.addEventListener('click', () => {
    const p = state.profile;
    state.pendingAvatar = undefined;
    els.editDisplay.value = p.display_name || p.username;
    els.editBio.value = p.bio || '';
    els.editLink.value = p.link_url || '';
    els.bioCount.textContent = `${els.editBio.value.length}/160`;
    els.editError.textContent = '';
    renderEditAvatar();
    els.editModal.classList.remove('hidden');
    els.editDisplay.focus();
});

els.editBio.addEventListener('input', () => {
    els.bioCount.textContent = `${els.editBio.value.length}/160`;
});

/** 고른 사진을 가운데 기준 정사각형으로 잘라 작게 줄인다 (원본 그대로 올리면 수 MB라 느리다) */
function squareAvatar(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = AVATAR_SIZE;
            canvas.getContext('2d').drawImage(img,
                (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
                0, 0, AVATAR_SIZE, AVATAR_SIZE);
            URL.revokeObjectURL(img.src);
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('변환 실패'))), 'image/webp', 0.86);
        };
        img.onerror = () => reject(new Error('이미지를 읽을 수 없습니다'));
        img.src = URL.createObjectURL(file);
    });
}

els.avatarInput.addEventListener('change', async () => {
    const file = els.avatarInput.files[0];
    els.avatarInput.value = '';
    if (!file) return;
    try {
        state.pendingAvatar = await squareAvatar(file);
        els.editError.textContent = '';
        renderEditAvatar();
    } catch (err) {
        els.editError.textContent = err.message;
    }
});

els.avatarRemove.addEventListener('click', () => {
    state.pendingAvatar = null;
    renderEditAvatar();
});

async function uploadAvatar(blob) {
    const folder = state.me.id;
    // 파일 이름에 시각을 붙여서, 사진을 바꾸면 주소도 바뀌어 브라우저가 옛 사진을 캐시에서 쓰지 않게 한다
    const path = `${folder}/avatar-${Date.now()}.webp`;
    const { error } = await supabaseClient.storage.from('avatars').upload(path, blob, { contentType: 'image/webp', upsert: true });
    if (error) throw error;
    await removeOldAvatars(path);
    return supabaseClient.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

async function removeOldAvatars(keepPath = null) {
    const folder = state.me.id;
    const { data } = await supabaseClient.storage.from('avatars').list(folder);
    const old = (data || []).map((f) => `${folder}/${f.name}`).filter((p) => p !== keepPath);
    if (old.length) await supabaseClient.storage.from('avatars').remove(old);
}

els.editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isOwn()) return;
    els.editError.textContent = '';
    els.editSave.disabled = true;
    els.editSave.textContent = '저장 중...';

    try {
        const update = {
            display_name: els.editDisplay.value.trim() || state.profile.username,
            bio: els.editBio.value.trim(),
            link_url: normalizeLink(els.editLink.value)
        };
        if (state.pendingAvatar) update.avatar_url = await uploadAvatar(state.pendingAvatar);
        else if (state.pendingAvatar === null) {
            update.avatar_url = null;
            await removeOldAvatars();
        }

        const { data, error } = await supabaseClient.from('profiles').update(update).eq('id', state.me.id).select().maybeSingle();
        if (error) throw error;
        state.profile = data || { ...state.profile, ...update };
        renderProfile();
        els.editModal.classList.add('hidden');
    } catch (err) {
        console.warn('프로필 저장 실패:', err);
        // 소개/링크 칸이나 사진 저장소가 아직 없을 때(supabase/profile_page.sql 실행 전)
        const missingSetup = /bio|link_url|avatar_url|bucket|not found/i.test(err.message || '');
        els.editError.textContent = missingSetup
            ? '저장 공간 설정이 아직 안 되어 있습니다 (supabase/profile_page.sql 실행 필요)'
            : `저장하지 못했습니다: ${err.message}`;
    } finally {
        els.editSave.disabled = false;
        els.editSave.textContent = '저장';
    }
});

init();
