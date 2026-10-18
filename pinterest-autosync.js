/**
 * Pinterest 자동 동기화 - 로그인한 사람이 페이지에 들어오면, Pinterest가 연결돼 있고 마지막 동기화 뒤
 * SYNC_EVERY가 지났을 때 새로 저장한 핀을 조용히 가져온다 (무료 서버라 정해진 시각에 도는 예약 작업 대신).
 * 새 핀이 들어오면, 전에 내 핀 분석을 해 둔 사람은 새 핀만 이어서 분석한다(pin-analyzer.js) -
 * 한 번도 분석하지 않은 사람에게는 이미지 모델을 갑자기 내려받게 하지 않는다.
 * 끝나면 'pinterest-synced' / 'pins-analyzed' 이벤트를 보내서 터널이 검색 색인을 새로 받게 한다.
 * supabase-client.js(supabaseClient)가 먼저 로드되어 있어야 한다.
 */
(function () {
    const SYNC_EVERY = 6 * 60 * 60 * 1000;
    const START_DELAY = 3000; // 페이지가 먼저 뜨도록 잠깐 기다렸다가

    function toast(text) {
        const el = document.createElement('div');
        el.textContent = text;
        el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9999;max-width:calc(100vw - 32px);'
            + 'background:#111;color:#fff;padding:10px 14px;border-radius:8px;font:12px/1.5 "SF Mono",Menlo,monospace;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,.2);opacity:0;transition:opacity .3s';
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 5000);
    }

    async function run() {
        if (typeof supabaseClient === 'undefined') return;
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return;
        const key = `pinterest-last-sync-${session.user.id}`;
        let last = 0;
        try { last = Number(localStorage.getItem(key)) || 0; } catch (e) { /* 저장소를 못 쓰면 매번 확인 */ }
        if (Date.now() - last < SYNC_EVERY) return;

        const headers = { Authorization: `Bearer ${session.access_token}` };
        const status = await (await fetch('/api/pinterest/status', { headers })).json();
        if (!status.connected) return;
        // 다른 탭이 동시에 시작하지 않도록 먼저 기록해 둔다
        try { localStorage.setItem(key, String(Date.now())); } catch (e) { /* 무시 */ }

        const response = await fetch('/api/pinterest/sync', { method: 'POST', headers });
        const data = await response.json();
        if (!response.ok || !data.inserted) return;
        toast(`Pinterest에서 새 핀 ${data.inserted.toLocaleString()}개를 가져왔어요`);
        window.dispatchEvent(new CustomEvent('pinterest-synced', { detail: { inserted: data.inserted } }));

        if (!window.PinAnalyzer) return;
        const { count } = await supabaseClient.from('pin_embeddings')
            .select('pin_id', { count: 'exact', head: true }).eq('owner_id', session.user.id);
        if (!count) return;
        const result = await PinAnalyzer.analyzeMine();
        window.dispatchEvent(new CustomEvent('pins-analyzed', { detail: result }));
    }

    window.addEventListener('load', () => {
        setTimeout(() => run().catch((err) => console.warn('Pinterest 자동 동기화 실패:', err)), START_DELAY);
    });
})();
