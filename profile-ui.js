/**
 * 사람 한 명을 보여주는 공통 조각 - 메인 페이지 사용자 검색, 팔로잉 목록, 개인 페이지 팔로워/팔로잉 목록이 같이 쓴다.
 * supabase-client.js 다음에 불러온다.
 */
const ProfileUI = (() => {
    const profileUrl = (username) => `profile.html?user=${encodeURIComponent(username)}`;
    const tunnelUrl = (username) => `gallery.html?user=${encodeURIComponent(username)}`;

    /** 프로필 사진 (없으면 이름 첫 글자를 파란 원 위에) */
    function avatar(profile, size = 28) {
        const el = document.createElement('span');
        el.className = 'pu-avatar';
        el.style.width = el.style.height = `${size}px`;
        el.style.fontSize = `${Math.round(size * 0.42)}px`;
        if (profile.avatar_url) {
            const img = document.createElement('img');
            img.src = profile.avatar_url;
            img.alt = '';
            img.onerror = () => { img.remove(); el.textContent = initial(profile); };
            el.appendChild(img);
        } else {
            el.textContent = initial(profile);
        }
        return el;
    }

    function initial(profile) {
        const name = (profile.display_name || profile.username || '?').trim();
        return Array.from(name)[0].toUpperCase();
    }

    /**
     * 사용자 한 줄: [사진] 이름 @사용자명 ........ [TUNNEL →]
     * 줄을 누르면 개인 페이지로, TUNNEL을 누르면 그 사람 터널로 바로 간다.
     */
    function row(profile) {
        // 줄 안에 TUNNEL 링크가 따로 있어서 줄 자체는 <a>로 만들 수 없다 (링크 안에 링크는 안 된다)
        const el = document.createElement('div');
        el.className = 'pu-row';
        el.setAttribute('role', 'link');
        el.tabIndex = 0;
        const open = () => { window.location.href = profileUrl(profile.username); };
        el.addEventListener('click', open);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });

        el.appendChild(avatar(profile));

        const names = document.createElement('span');
        names.className = 'pu-names';
        const display = document.createElement('span');
        display.className = 'pu-display';
        display.textContent = profile.display_name || profile.username;
        const handle = document.createElement('span');
        handle.className = 'pu-handle';
        handle.textContent = `@${profile.username}`;
        names.append(display, handle);
        el.appendChild(names);

        const tunnel = document.createElement('a');
        tunnel.className = 'pu-tunnel';
        tunnel.href = tunnelUrl(profile.username);
        tunnel.textContent = 'TUNNEL →';
        tunnel.addEventListener('click', (e) => e.stopPropagation());
        el.appendChild(tunnel);

        return el;
    }

    /** 구글/카카오로 가입하고 아직 사용자명을 안 정한 임시 계정은 검색·목록에서 뺀다 */
    const PROFILE_COLUMNS = 'id, username, display_name, avatar_url, username_is_placeholder';
    const PROFILE_COLUMNS_FALLBACK = 'id, username, display_name, username_is_placeholder';

    /** avatar_url 칸이 아직 없는 DB(SQL을 실행하기 전)에서도 동작하도록 한 번 더 시도한다 */
    async function selectProfiles(build) {
        let result = await build(supabaseClient.from('profiles').select(PROFILE_COLUMNS));
        if (result.error && /avatar_url/.test(result.error.message || '')) {
            result = await build(supabaseClient.from('profiles').select(PROFILE_COLUMNS_FALLBACK));
        }
        return result;
    }

    /** 사용자명이나 이름에 검색어가 들어간 사람 */
    async function searchUsers(query, limit = 8) {
        const q = query.trim().replace(/[%_,()]/g, '');
        if (!q) return [];
        const { data, error } = await selectProfiles((sel) => sel
            .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
            .eq('username_is_placeholder', false)
            .order('username')
            .limit(limit));
        if (error) throw error;
        // 사용자명이 검색어로 시작하는 사람을 먼저
        const lower = q.toLowerCase();
        return (data || []).sort((a, b) => Number(!a.username.toLowerCase().startsWith(lower)) - Number(!b.username.toLowerCase().startsWith(lower)));
    }

    async function profilesByIds(ids) {
        if (!ids.length) return [];
        const { data, error } = await selectProfiles((sel) => sel.in('id', ids));
        if (error) throw error;
        const order = new Map(ids.map((id, i) => [id, i]));
        return (data || []).sort((a, b) => order.get(a.id) - order.get(b.id));
    }

    /** 이 사람을 팔로우하는 사람들 / 이 사람이 팔로우하는 사람들 (최근 순) */
    async function followers(userId) {
        const { data, error } = await supabaseClient.from('follows').select('follower_id')
            .eq('followee_id', userId).order('created_at', { ascending: false });
        if (error) throw error;
        return profilesByIds((data || []).map((r) => r.follower_id));
    }

    async function following(userId) {
        const { data, error } = await supabaseClient.from('follows').select('followee_id')
            .eq('follower_id', userId).order('created_at', { ascending: false });
        if (error) throw error;
        return profilesByIds((data || []).map((r) => r.followee_id));
    }

    return { profileUrl, tunnelUrl, avatar, row, searchUsers, followers, following };
})();
