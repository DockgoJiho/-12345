/**
 * Pinterest 파티클 갤러리
 * 추상적인 입자가 부유하면서 마우스 인터랙션으로 이미지 미리보기 및 확대 표시
 */

class ParticleGallery {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.previewPanel = document.getElementById('preview-panel');
        this.detailPage = document.getElementById('detail-page');
        this.detailClose = document.getElementById('detail-close');
        this.detailMemo = document.getElementById('detail-memo');
        this.memoSaveTimer = null;
        this.currentDetailPinId = null;

        this.searchToggle = document.getElementById('search-toggle');
        this.searchPanel = document.getElementById('search-panel');
        this.searchTagsEl = document.getElementById('search-tags');
        this.searchTagInput = document.getElementById('search-tag-input');
        this.searchResultsEl = document.getElementById('search-results');
        this.searchTags = [];
        this.searchRequestId = 0;
        this.relatedRequestId = 0;

        this.backHomeLink = document.querySelector('.back-home-link');

        // 마우스를 따라다니며 검색 버튼을 가리키는 화살표의 상태
        this.searchPointer = document.getElementById('search-pointer');
        this.searchPointerHint = document.getElementById('search-pointer-hint');
        this.pointerTarget = { x: -200, y: -200 };
        this.pointerPos = { x: -200, y: -200 };
        this.pointerAngle = 0;
        this.pointerHasMoved = false;
        this.showPointerHint = false;

        // 이미지 우클릭 → 삭제 확인 팝업
        this.deleteConfirm = document.getElementById('delete-confirm');
        this.deleteConfirmCancel = document.getElementById('delete-confirm-cancel');
        this.deleteConfirmDeleteBtn = document.getElementById('delete-confirm-delete');
        this.pendingDeleteParticle = null;

        this.raycaster = new THREE.Raycaster();
        this.hoveredParticle = null;
        // 모바일 터치: 터치 시작 지점(탭 vs 드래그 판정용) - 마우스의 mouseDownPos와 별도로 관리
        this.touchStartPos = null;
        this.particles = [];
        this.pinsData = [];
        this.isLoading = true;
        this.introPlaying = false;

        // 스페이스바를 누르고 있으면 터널이 더 빠르게 흘러간다
        this.driftBoostActive = false;
        this.driftBoostMultiplier = 1;

        this.init();
        this.setupEventListeners();
        this.loadPinsFromAPI();
        this.openDirectPinIfLinked();
        this.openSearchFromQueryParam();
        this.maybeShowSearchHint();
    }

    /**
     * 메인 페이지 ARCHIVE INDEX의 카테고리를 눌러 들어온 경우(gallery.html?q=카테고리),
     * 터널에 도착하자마자 검색 패널을 열고 그 카테고리를 태그로 넣어 바로 결과를 보여준다.
     */
    openSearchFromQueryParam() {
        const query = new URLSearchParams(window.location.search).get('q');
        if (!query) return;

        this.searchPanel.classList.remove('hidden');
        this.addSearchTag(query);
    }

    /**
     * 화살표가 검색 버튼을 가리킨다는 사실이 회전이 점진적이어서 잘 안 읽힌다는
     * 피드백에 따른 보완책. 이 브라우저에서 처음 터널에 들어왔을 때 한 번만,
     * 화살표와 검색 버튼을 동시에 펄스시키고 화살표 옆에 "SEARCH →" 힌트를 잠깐
     * 띄워서 "이 화살표 = 저기 검색 있음"이라는 관계를 명시적으로 가르쳐준다.
     * 한 번 보고 나면 다시는 반복하지 않고, 평소엔 조용히 회전만 한다.
     */
    maybeShowSearchHint() {
        let alreadySeen = false;
        try {
            alreadySeen = !!localStorage.getItem('searchHintSeen');
            localStorage.setItem('searchHintSeen', '1');
        } catch (err) {
            // localStorage를 못 쓰는 환경이면 매번 살짝 보여줘도 무방하니 그냥 진행한다
        }
        if (alreadySeen) return;

        const PULSE_DURATION = 4200; // search-toggle-pulse/search-pointer-pulse의 1.4s x 3회와 맞춘다

        setTimeout(() => {
            this.searchToggle.classList.add('pulse');
            this.searchPointer.classList.add('pulse');
            this.showPointerHint = true;
            this.searchPointerHint.classList.add('visible');

            setTimeout(() => {
                this.searchToggle.classList.remove('pulse');
                this.searchPointer.classList.remove('pulse');
                this.showPointerHint = false;
                this.searchPointerHint.classList.remove('visible');
            }, PULSE_DURATION);
        }, 2500);
    }

    /**
     * 메인 페이지 마퀴 카드 클릭(gallery.html?pin=아이디)처럼, 터널에 뿌려지는
     * 무작위 샘플과 무관하게 특정 핀 하나를 바로 상세 페이지로 열어야 할 때 사용한다.
     */
    async openDirectPinIfLinked() {
        const pinId = new URLSearchParams(window.location.search).get('pin');
        if (!pinId) return;

        try {
            const response = await fetch(`/api/pin/${encodeURIComponent(pinId)}`);
            const data = await response.json();
            if (data.success && data.pin) {
                this.showDetailPage(data.pin);
            }
        } catch (err) {
            console.warn('링크된 핀을 불러오지 못했습니다:', err);
        }
    }

    init() {
        // Scene 설정 - 하얀 배경 속에 빽빽한 화면들이 늘어선 "아카이브 터널"
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf7f5f1);
        this.scene.fog = new THREE.FogExp2(0xf7f5f1, 0.045);

        // 터널 파라미터
        this.tunnelRadius = 6.5;
        this.tunnelRingSpacing = 2.0;
        this.tunnelRingCount = 34;
        this.tunnelCardsPerRing = 16;
        this.tunnelDepth = this.tunnelRingSpacing * this.tunnelRingCount;
        this.driftSpeed = 0.01;

        // Camera 설정 - 터널 안쪽에서 안을 들여다보는 구도
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        this.camera.position.set(0, 0, 2);

        // Renderer 설정
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            precision: 'highp'
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // 마우스 드래그로 회전, 휠로 줌, 우클릭 드래그로 이동 - 어느 각도에서든 볼 수 있게 함.
        // 블렌더처럼 Shift를 누른 채 마우스 휠(가운데) 버튼을 드래그하면 카메라 자체를
        // x/y로 트럭(pan)하듯 옮길 수 있다 (평소엔 가운데 버튼 = 줌)
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 40;
        this.controls.target.set(0, 0, -6);
        this.defaultMiddleMouseAction = this.controls.mouseButtons.MIDDLE;

        // TextureLoader 초기화 - 같은 이미지를 여러 카드가 재사용할 때 중복 요청 방지
        THREE.Cache.enabled = true;
        this.textureLoader = new THREE.TextureLoader();
        this.textureLoader.setCrossOrigin('anonymous');

        // 카드들은 스스로 빛나는 화면처럼 보여야 하므로 장면 조명은 최소한으로만 둔다
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
        this.scene.add(ambientLight);

        // 입자 그룹
        this.particleGroup = new THREE.Group();
        this.scene.add(this.particleGroup);

        // 원통 바깥쪽 먼 공간에 옅게 흩날리는 페이지 조각들 (호버/클릭 대상 아님)
        this.dustGroup = new THREE.Group();
        this.scene.add(this.dustGroup);
        this.backgroundDust = [];
        this.createBackgroundDust();

        // 로딩 표시
        this.showLoading();
    }

    /**
     * API에서 Pinterest 핀 데이터 로드
     */
    async loadPinsFromAPI() {
        try {
            console.log('📌 Pinterest 데이터를 서버에서 로드 중...');
            const response = await fetch('/api/pins');

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();

            if (data.success && data.pins && data.pins.length > 0) {
                console.log(`✓ ${data.pins.length}개의 핀을 로드했습니다`);
                this.pinsData = data.pins;
                this.hideLoading();
                this.createParticles();
                this.playEntranceAnimation();
                this.animate();
            } else {
                throw new Error('핀 데이터를 가져올 수 없습니다');
            }
        } catch (error) {
            console.error('Pinterest API 로드 실패:', error);
            this.showError(error.message);
            
            // 실패 시 샘플 데이터 사용
            console.log('샘플 데이터로 갤러리를 초기화합니다');
            this.pinsData = PINS_DATA;
            this.hideLoading();
            this.createParticles();
            this.animate();
        }
    }

    showLoading() {
        const loading = document.createElement('div');
        loading.className = 'loading';
        loading.textContent = '📌 Pinterest 핀을 불러오는 중...';
        loading.id = 'loading-indicator';
        this.container.appendChild(loading);
    }

    hideLoading() {
        const loading = document.getElementById('loading-indicator');
        if (loading) {
            loading.remove();
        }
    }

    showError(message) {
        const errorEl = document.createElement('div');
        errorEl.className = 'loading';
        errorEl.textContent = `⚠️ ${message}`;
        errorEl.style.color = '#e74c3c';
        errorEl.id = 'error-indicator';
        this.container.appendChild(errorEl);
    }

    createParticles() {
        // 원통형 아카이브 터널: 여러 겹의 고리(ring)를 따라 카드를 촘촘히 배치한다.
        // 카메라가 터널 안쪽 축을 따라 이동하며, 사방이 화면으로 둘러싸인 느낌을 준다.
        const ringCount = this.tunnelRingCount;
        const cardsPerRing = this.tunnelCardsPerRing;
        let index = 0;

        for (let ring = 0; ring < ringCount; ring++) {
            // 고리마다 살짝 회전을 주어 앞뒤 고리가 서로 어긋나게 배치(벽돌쌓기 패턴)
            const ringOffset = (ring % 2 === 0) ? 0 : (Math.PI / cardsPerRing);
            const z = -ring * this.tunnelRingSpacing;

            for (let slot = 0; slot < cardsPerRing; slot++) {
                const pinData = this.pinsData[index % this.pinsData.length];
                index++;

                const angle = (slot / cardsPerRing) * Math.PI * 2 + ringOffset + (Math.random() - 0.5) * 0.12;
                const radius = this.tunnelRadius + (Math.random() - 0.5) * 0.6;
                const jitterZ = (Math.random() - 0.5) * (this.tunnelRingSpacing * 0.3);
                const finalZ = z + jitterZ;

                // 입장 연출용: 처음엔 저 먼 소실점 한 점에 뭉쳐 있다가(반경 0에 가깝고 아주 깊은 z)
                // 열차처럼 뿜어져 나와 제자리(반경/깊이 모두 정상값)로 달려온다
                const spawnRadius = 0.25;
                const spawnZ = -this.tunnelDepth * 2.4;

                const particle = {
                    position: new THREE.Vector3(
                        Math.cos(angle) * spawnRadius,
                        Math.sin(angle) * spawnRadius,
                        spawnZ
                    ),
                    baseZ: finalZ,
                    angle,
                    radius,
                    spawnRadius,
                    spawnZ,
                    // 카드마다 전체 크기(면적)를 다르게 줘서 획일적인 그리드처럼 보이지 않게 한다.
                    // 실제 이미지의 가로세로 비율은 로드된 뒤에 알게 되므로 createImageCard에서 반영한다.
                    sizeScale: 0.75 + Math.random() * 0.6,
                    mesh: null,
                    pinData: {
                        id: pinData.id,
                        title: pinData.title || '제목 없음',
                        description: pinData.description || '설명 없음',
                        image: pinData.image || '',
                        tags: this.extractTags(pinData),
                        customTags: Array.isArray(pinData.customTags) ? pinData.customTags.slice() : [],
                        link: pinData.link || '',
                        creator: pinData.creator || '알 수 없음',
                        memo: pinData.memo || ''
                    }
                };

                // 이미지 텍스쳐를 가진 카드 형태의 파티클 (터널 안쪽, 즉 중심축을 향해 face)
                // lookAt은 angle에만 의존하므로 spawn 위치에서 계산해도 최종 위치에서도 그대로 맞다
                particle.mesh = this.createImageCard(particle, pinData);
                particle.mesh.position.copy(particle.position);
                particle.mesh.lookAt(0, 0, particle.position.z);
                particle.mesh.rotateY(Math.PI);
                particle.mesh.userData.particle = particle;

                this.particleGroup.add(particle.mesh);
                this.particles.push(particle);
            }
        }
    }

    /**
     * 터널 바깥쪽 먼 공간에 아주 옅고 성기게 떠 있는 페이지 조각들.
     * "지금 지나가는 이 통로는 무한한 지식의 공간 중 일부일 뿐"이라는 암시만 준다.
     * 실제 카드가 아니므로 호버/클릭 대상에서 제외하고 particleGroup과 분리해서 관리한다.
     */
    createBackgroundDust() {
        const dustCount = 1000;

        // 옅은 회색 테두리가 있는 "페이지" 모양 텍스처 하나를 모든 조각이 공유한다
        const dustCanvas = document.createElement('canvas');
        dustCanvas.width = 64;
        dustCanvas.height = 64;
        const dctx = dustCanvas.getContext('2d');
        dctx.fillStyle = 'rgba(180, 175, 190, 0.9)';
        dctx.fillRect(0, 0, 64, 64);
        dctx.strokeStyle = 'rgba(120, 115, 135, 0.9)';
        dctx.lineWidth = 4;
        dctx.strokeRect(2, 2, 60, 60);
        const dustTexture = new THREE.CanvasTexture(dustCanvas);

        for (let i = 0; i < dustCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            // 터널 바로 바깥쪽에 더 몰리고, 멀어질수록 성기게 퍼지도록 편중시킨다
            // (전부 균일하게 뿌리면 시야에 거의 안 걸리므로 가까운 쪽 밀도를 높임)
            const radius = this.tunnelRadius + 2 + Math.random() * Math.random() * 28;
            const z = -Math.random() * this.tunnelDepth * 1.4;

            const size = 0.4 + Math.random() * 0.7;
            const geometry = new THREE.PlaneGeometry(size, size * (0.7 + Math.random() * 0.5));
            const material = new THREE.MeshBasicMaterial({
                map: dustTexture,
                color: 0xffffff,
                transparent: true,
                opacity: 0.22 + Math.random() * 0.35,
                side: THREE.DoubleSide,
                depthWrite: false
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

            this.dustGroup.add(mesh);
            this.backgroundDust.push({ mesh, spinX: (Math.random() - 0.5) * 0.002, spinY: (Math.random() - 0.5) * 0.002 });
        }
    }

    /**
     * "링크 스타트" 진입 연출 - 터널은 처음엔 존재하지 않다가, 정면 소실점에서
     * 카드들이 열차처럼 뿜어져 나와 제자리를 채운다. 카메라는 처음부터 끝까지
     * 정상적인 정면 구도 그대로 고정되어 있다.
     * 이 동안은 OrbitControls를 잠시 꺼서 사용자 조작과 충돌하지 않게 한다.
     */
    playEntranceAnimation() {
        const duration = 2200;

        // 카드 수백 개를 만드느라 메인 스레드가 잠깐 멈추는데, 그 시간까지
        // 애니메이션 진행률에 포함되면 시작하자마자 끝난 것처럼 보인다.
        // 그래서 시작 시각은 함수 호출 시점이 아니라 "실제로 첫 프레임이
        // 그려지는 시점"(rAF 콜백이 처음 실행되는 순간)으로 잡는다.
        let startTime = null;

        this.controls.enabled = false;
        this.introPlaying = true;

        const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

        const step = (now) => {
            if (startTime === null) startTime = now;
            const t = Math.min((now - startTime) / duration, 1);
            const eCard = easeOutQuart(t);

            // 소실점(정면) 한 점에 뭉쳐 있던 카드들이 열차처럼 뿜어져 나와 제자리를 채운다
            this.particles.forEach((p) => {
                const r = p.spawnRadius + (p.radius - p.spawnRadius) * eCard;
                const z = p.spawnZ + (p.baseZ - p.spawnZ) * eCard;
                p.position.set(Math.cos(p.angle) * r, Math.sin(p.angle) * r, z);
                p.mesh.position.copy(p.position);
            });

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                this.controls.enabled = true;
                this.introPlaying = false;
            }
        };

        requestAnimationFrame(step);
    }

    /**
     * 이미지를 텍스쳐로 하는 카드 형태의 파티클 생성
     */
    createImageCard(particle, pinData) {
        // 포켓몬 카드처럼 두께 없는 완전히 평평한 카드로 표현한다.
        // 모든 카드를 같은 박스 규격에 억지로 맞추지 않고, 실제 이미지의 가로세로 비율과
        // particle.sizeScale(카드마다 다른 전체 크기)을 그대로 반영해 시각적으로 다양하게 만든다.
        const baseHeight = 1.4 * particle.sizeScale;

        // 이미지가 로드되기 전까지 보여줄 placeholder 비율도 몇 가지 중에 무작위로 골라서,
        // 로드 완료 전부터 이미 크기/비율이 제각각으로 보이게 한다
        const PLACEHOLDER_ASPECTS = [0.75, 0.85, 1, 1.15, 1.3, 1.5];
        let aspect = PLACEHOLDER_ASPECTS[Math.floor(Math.random() * PLACEHOLDER_ASPECTS.length)];

        const geometry = new THREE.PlaneGeometry(baseHeight * aspect, baseHeight);

        // 카드마다 하나의 액센트 색을 정해서, 테두리/캡션 바 등 공통 프레임에 일관되게 사용한다
        // (상세 페이지를 열 때도 같은 색을 재사용하기 위해 particle.pinData에 저장해둔다)
        const accentColors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#00c2b8', '#e8875f'];
        const accentColor = accentColors[Math.floor(Math.random() * accentColors.length)];
        particle.pinData.accentColor = accentColor;

        // 이미지가 로드되기 전에도 동일한 프레임 디자인을 보여준다 (그라디언트 placeholder)
        const canvas = this.renderCardFace(null, pinData, accentColor, aspect);
        const canvasTexture = new THREE.CanvasTexture(canvas);
        canvasTexture.magFilter = THREE.LinearFilter;
        canvasTexture.minFilter = THREE.LinearMipmapLinearFilter;
        canvasTexture.anisotropy = 16;

        // 스스로 빛나는 화면처럼 보이도록 조명의 영향을 받지 않는 재질을 사용한다.
        // DoubleSide라 평면 한 장으로 앞/뒤 어느 쪽에서 봐도 같은 이미지가 보인다
        // (뒷면을 블러 처리하면 안쪽에서 봤을 때 어색해서 앞뒤를 동일하게 통일)
        const material = new THREE.MeshBasicMaterial({
            map: canvasTexture,
            side: THREE.DoubleSide
        });

        const card = new THREE.Mesh(geometry, material);
        card.position.copy(particle.position);
        card.userData.imageUrl = pinData.image;
        card.userData.isImageLoaded = false;
        card.userData.particle = particle;

        // 실제 Pinterest 이미지 비동기 로드 (mesh 생성 후)
        // 로컬로 미리 받아둔 이미지(/images/...)는 그대로 사용하고,
        // 그렇지 않은 경우(Pinterest CDN 원본 URL)는 CORS 문제로 서버 프록시를 거쳐서 로드한다
        if (pinData.image && this.textureLoader) {
            const isLocalImage = pinData.image.startsWith('/images/');
            const loadUrl = isLocalImage
                ? pinData.image
                : `/api/image?url=${encodeURIComponent(pinData.image)}`;

            this.textureLoader.load(
                loadUrl,
                (loadedTexture) => {
                    // 실제 이미지의 원본 비율을 알게 됐으니, placeholder 비율 대신 진짜 비율로
                    // 지오메트리를 다시 만든다 (극단적으로 길쭉해지지 않도록만 범위를 제한한다)
                    const img = loadedTexture.image;
                    const realAspect = img && img.naturalWidth && img.naturalHeight
                        ? img.naturalWidth / img.naturalHeight
                        : aspect;
                    aspect = Math.min(Math.max(realAspect, 0.55), 1.8);

                    const newGeometry = new THREE.PlaneGeometry(baseHeight * aspect, baseHeight);
                    card.geometry.dispose();
                    card.geometry = newGeometry;

                    // 실제 사진도 동일한 프레임 디자인 안에 넣어서 일관된 인터페이스로 보이게 한다
                    const framedCanvas = this.renderCardFace(img, pinData, accentColor, aspect);
                    const framedTexture = new THREE.CanvasTexture(framedCanvas);
                    framedTexture.magFilter = THREE.LinearFilter;
                    framedTexture.minFilter = THREE.LinearMipmapLinearFilter;
                    framedTexture.anisotropy = 16;

                    material.map = framedTexture;
                    material.needsUpdate = true;
                    card.userData.isImageLoaded = true;
                    console.log('📸 이미지 로드 완료:', pinData.title);
                },
                undefined,
                () => {
                    // 로드 실패 시 캔버스 텍스처 유지
                    console.warn('📸 이미지 로드 실패, 캔버스 텍스처 사용:', pinData.title);
                }
            );
        }

        return card;
    }

    /**
     * 모든 카드에 공통으로 적용되는 프레임(매트+테두리+캡션 바) 안에
     * 이미지(또는 placeholder 그라디언트)를 그려 넣은 캔버스를 생성한다.
     * image가 null이면 이미지 로딩 전 placeholder를 그린다.
     * aspect(가로/세로)에 맞춰 캔버스 자체의 가로세로 비율도 카드마다 다르게 만든다.
     */
    renderCardFace(image, pinData, accentColor, aspect = 1.2) {
        // 터널 안에 수백 장이 동시에 존재하므로 해상도를 적당히 낮춰 GPU 메모리를 아낀다
        const height = 264;
        const width = Math.round(height * aspect);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // 매트 배경
        ctx.fillStyle = '#f7f5f1';
        ctx.fillRect(0, 0, width, height);

        // 바깥 액센트 테두리 (모든 카드에 공통으로 적용되는 프레임)
        const border = 5;
        ctx.fillStyle = accentColor;
        ctx.fillRect(0, 0, width, border);
        ctx.fillRect(0, height - border, width, border);
        ctx.fillRect(0, 0, border, height);
        ctx.fillRect(width - border, 0, border, height);

        // 이미지 영역 (둥근 모서리로 클립)
        const margin = 15;
        const captionHeight = 35;
        const imgX = margin;
        const imgY = margin;
        const imgW = width - margin * 2;
        const imgH = height - margin * 2 - captionHeight;
        const radius = 8;

        ctx.save();
        this.roundRectPath(ctx, imgX, imgY, imgW, imgH, radius);
        ctx.clip();
        if (image) {
            this.drawImageCover(ctx, image, imgX, imgY, imgW, imgH);
        } else {
            const gradient = ctx.createLinearGradient(imgX, imgY, imgX + imgW, imgY + imgH);
            gradient.addColorStop(0, this.lightenColor(accentColor, 30));
            gradient.addColorStop(1, this.darkenColor(accentColor, 20));
            ctx.fillStyle = gradient;
            ctx.fillRect(imgX, imgY, imgW, imgH);
        }
        ctx.restore();

        // 이미지 가장자리 얇은 라인 (매트 위에 놓인 사진 느낌)
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.lineWidth = 1.5;
        this.roundRectPath(ctx, imgX, imgY, imgW, imgH, radius);
        ctx.stroke();

        // 하단 캡션 바 (모든 카드가 공유하는 인터페이스 요소)
        const capY = imgY + imgH + 6;
        const capH = captionHeight - 6;
        this.roundRectPath(ctx, imgX, capY, imgW, capH, 6);
        ctx.fillStyle = accentColor;
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.font = '600 12px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const text = (pinData.description || pinData.title || '핀터레스트').trim().slice(0, 24);
        ctx.fillText(text, imgX + 10, capY + capH / 2 + 1);

        ctx.beginPath();
        ctx.arc(imgX + imgW - 11, capY + capH / 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fill();

        return canvas;
    }

    /**
     * 둥근 사각형 경로 (구형 브라우저 호환을 위해 arcTo로 직접 구현)
     */
    roundRectPath(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /**
     * object-fit: cover 방식으로 이미지를 영역에 꽉 채워 그린다 (비율 유지, 넘치는 부분은 크롭)
     */
    drawImageCover(ctx, img, x, y, w, h) {
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        if (!iw || !ih) return;
        // 원본 핀 이미지 캡처 자체에 핀터레스트 페이지의 둥근 모서리(배경색이 비쳐 보이는
        // 흰 여백)가 섞여 들어가 있어서, 카드 비율이 이미지 비율과 거의 같아 크롭이 거의
        // 안 일어날 때도 그 모서리가 보이지 않도록 필요한 배율보다 살짝 더 확대해서 그린다
        const scale = Math.max(w / iw, h / ih) * 1.08;
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = x + (w - dw) / 2;
        const dy = y + (h - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
    }

    /**
     * 색상 밝게 조정
     */
    lightenColor(hexColor, amount) {
        const hex = hexColor.replace('#', '');
        const r = Math.min(255, parseInt(hex.substring(0, 2), 16) + amount);
        const g = Math.min(255, parseInt(hex.substring(2, 4), 16) + amount);
        const b = Math.min(255, parseInt(hex.substring(4, 6), 16) + amount);
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    
    /**
     * 색상 어둡게 조정
     */
    darkenColor(hexColor, amount) {
        const hex = hexColor.replace('#', '');
        const r = Math.max(0, parseInt(hex.substring(0, 2), 16) - amount);
        const g = Math.max(0, parseInt(hex.substring(2, 4), 16) - amount);
        const b = Math.max(0, parseInt(hex.substring(4, 6), 16) - amount);
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    /**
     * 핀 데이터에서 태그 추출 (제목과 설명 기반)
     */
    extractTags(pinData) {
        const tags = [];
        const title = pinData.title || '';
        const description = pinData.description || '';
        const combinedText = `${title} ${description}`.toLowerCase();
        
        // 키워드 추출
        const keywords = [
            'design', 'art', 'photography', 'nature', 'fashion',
            'architecture', 'interior', 'travel', 'food', 'tech',
            'minimal', 'modern', 'vintage', 'creative', 'abstract'
        ];
        
        keywords.forEach(keyword => {
            if (combinedText.includes(keyword)) {
                tags.push(keyword);
            }
        });
        
        // 제목에서 주요 단어 추출
        const titleWords = title.split(' ').filter(word => word.length > 3);
        tags.push(...titleWords.slice(0, 2));
        
        // 중복 제거 및 최대 5개까지만
        return Array.from(new Set(tags)).slice(0, 5);
    }

    createRandomGeometry(particle, dominantColor) {
        const geometries = [
            () => new THREE.BoxGeometry(0.8, 0.8, 0.8),
            () => new THREE.IcosahedronGeometry(0.5, 1),
            () => new THREE.OctahedronGeometry(0.6, 0),
            () => new THREE.TetrahedronGeometry(0.7, 0),
            () => new THREE.DodecahedronGeometry(0.5, 0),
            () => new THREE.SphereGeometry(0.5, 8, 8),
        ];
        
        const randomGeometry = geometries[Math.floor(Math.random() * geometries.length)]();
        
        // 핀의 dominant color 사용, 없으면 기본 그라디언트 색상
        let color;
        if (dominantColor && dominantColor.startsWith('#')) {
            try {
                color = new THREE.Color(dominantColor);
            } catch {
                color = new THREE.Color(0x667eea);
            }
        } else {
            const defaultColors = [
                new THREE.Color(0x667eea),
                new THREE.Color(0x764ba2),
                new THREE.Color(0xf093fb),
                new THREE.Color(0x4facfe),
                new THREE.Color(0x00f2fe),
                new THREE.Color(0xa8edea),
            ];
            color = defaultColors[Math.floor(Math.random() * defaultColors.length)];
        }
        
        const material = new THREE.MeshPhongMaterial({
            color: color,
            emissive: new THREE.Color(0x222222),
            shininess: 100,
            wireframe: Math.random() > 0.7 // 30% 확률로 와이어프레임
        });
        
        const mesh = new THREE.Mesh(randomGeometry, material);
        mesh.position.copy(particle.position);
        
        return mesh;
    }

    setupEventListeners() {
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('click', (e) => this.onClick(e));
        window.addEventListener('resize', () => this.onWindowResize());
        window.addEventListener('contextmenu', (e) => this.onContextMenu(e));

        // 모바일 터치: 손가락을 대고 있으면 미리보기, 짧게 탭하면 카드 열기 (touchstart/move는
        // OrbitControls의 회전 제스처를 막지 않도록 passive로 등록하고, touchend만
        // 합성 click을 억제해야 해서 passive가 아니게 등록한다)
        window.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: true });
        window.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: true });
        window.addEventListener('touchend', (e) => this.onTouchEnd(e));

        // Shift를 누르고 있는 동안엔 가운데 버튼 드래그가 줌(DOLLY) 대신 이동(PAN)으로 바뀐다
        // (블렌더의 Shift+마우스휠 드래그와 같은 조작)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') this.controls.mouseButtons.MIDDLE = this.defaultMiddleMouseAction;
        });

        // 클릭이 카드를 여는 것으로 오인되지 않도록, 드래그로 끝난 클릭(마우스가 유의미하게
        // 움직인 경우)은 mousedown 시점 위치를 기억해뒀다가 onClick에서 걸러낸다.
        window.addEventListener('mousedown', (e) => {
            this.mouseDownPos = { x: e.clientX, y: e.clientY };
        });

        // 스페이스바를 누르고 있는 동안 터널이 더 빠르게 흘러간다 (입력창에 타이핑 중일 땐 무시)
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !this.isTypingContext(e.target)) {
                e.preventDefault();
                this.driftBoostActive = true;
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') this.driftBoostActive = false;
        });
        // 창이 포커스를 잃으면(다른 앱/탭으로 전환 등) keyup이나 mouseup이 이 페이지로
        // 안 들어올 수 있다 - 그러면 Shift를 누른 채로 포커스를 잃었을 때 가운데 버튼이
        // PAN에 눌린 채로 영원히 남거나, mousedown만 기록된 채 다음 클릭의 드래그 거리
        // 판정이 엉뚱해질 수 있다. 포커스를 되찾을 때마다 관련 상태를 안전하게 초기화한다.
        window.addEventListener('blur', () => {
            this.driftBoostActive = false;
            this.controls.mouseButtons.MIDDLE = this.defaultMiddleMouseAction;
            this.mouseDownPos = null;
        });

        // Esc: 열려 있는 오버레이가 있으면 가까운 것부터 하나씩 닫고, 아무것도 없으면
        // 메인 페이지로 나간다
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!this.deleteConfirm.classList.contains('hidden')) {
                this.hideDeleteConfirm();
                return;
            }
            if (!this.detailPage.classList.contains('hidden')) {
                this.closeDetailPage();
                return;
            }
            if (!this.searchPanel.classList.contains('hidden')) {
                this.searchPanel.classList.add('hidden');
                return;
            }
            window.location.href = 'index.html';
        });

        this.deleteConfirmCancel.addEventListener('click', () => this.hideDeleteConfirm());
        this.deleteConfirmDeleteBtn.addEventListener('click', () => this.confirmDeletePin());

        // 검색 버튼을 가리키는 화살표는 카드 호버/클릭 로직과 무관하게
        // 항상 최신 커서 위치를 알아야 하므로 별도 리스너로 추적한다
        window.addEventListener('mousemove', (e) => {
            this.pointerTarget.x = e.clientX;
            this.pointerTarget.y = e.clientY;
            this.pointerHasMoved = true;
        });

        this.detailClose.addEventListener('click', () => this.closeDetailPage());
        this.detailMemo.addEventListener('input', () => this.onMemoInput());

        const tagInput = document.getElementById('detail-tag-input');
        tagInput.addEventListener('keydown', (e) => {
            // 한글 등 조합형 입력 중에 눌린 Enter는 무시한다 - 그렇지 않으면 아직 조합 중인
            // 완성되지 않은 글자가 그대로(또는 다음 글자와 뒤섞여) 태그로 추가되어 버린다.
            if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                this.addDetailTag(tagInput.value);
                tagInput.value = '';
            }
        });

        this.searchToggle.addEventListener('click', () => this.toggleSearchPanel());
        this.searchTagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                this.addSearchTag(this.searchTagInput.value);
                this.searchTagInput.value = '';
            } else if (e.key === 'Backspace' && this.searchTagInput.value === '' && this.searchTags.length > 0) {
                this.removeSearchTag(this.searchTags[this.searchTags.length - 1]);
            }
        });

        // 검색 패널/상세 페이지 안에서 일어나는 클릭(태그 삭제 등)은 3D 씬 클릭 처리로
        // 번지면 안 된다. innerHTML을 다시 그리면서 클릭된 요소 자체가 DOM에서 떨어져 나가면
        // 이후 window의 onClick에서 하던 contains() 검사가 무력화되므로, 아예 여기서
        // 이벤트 전파를 막아 window까지 올라가지 않게 한다.
        this.searchPanel.addEventListener('click', (e) => e.stopPropagation());
        this.searchToggle.addEventListener('click', (e) => e.stopPropagation());
        // 카드 바깥(배경) 클릭만은 예외적으로 올려보내서 window의 onClick이 상세 페이지를
        // 닫게 한다 - 카드 안쪽 클릭은 여전히 여기서 막아 위 주석의 stale-DOM 문제를 피한다.
        this.detailPage.addEventListener('click', (e) => {
            if (e.target === this.detailPage) return;
            e.stopPropagation();
        });

        // "/" 단축키로 검색 패널을 바로 열고 입력에 포커스 (다른 입력창에 타이핑 중일 땐 무시)
        window.addEventListener('keydown', (e) => {
            if (e.key === '/' && !this.isTypingContext(e.target)) {
                e.preventDefault();
                this.searchPanel.classList.remove('hidden');
                this.searchToggle.classList.remove('pulse');
                this.searchTagInput.focus();
            }
        });
    }

    isTypingContext(target) {
        if (!target) return false;
        const tag = target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    }

    /**
     * 터널 안에서 키워드를 태그처럼 하나씩 추가/제거하며 검색하는 패널.
     * 태그가 늘어날수록 서버에서 AND 조건 + 관련도 점수로 좁혀진 결과를 받아 목록으로 보여준다.
     */
    toggleSearchPanel() {
        const opening = this.searchPanel.classList.contains('hidden');
        this.searchPanel.classList.toggle('hidden', !opening);
        if (opening) {
            this.searchTagInput.focus();
        }
    }

    addSearchTag(rawValue) {
        const value = String(rawValue || '').trim().toLowerCase();
        if (!value || this.searchTags.includes(value)) return;
        this.searchTags.push(value);
        this.renderSearchTags();
        this.runSearch();
    }

    removeSearchTag(value) {
        this.searchTags = this.searchTags.filter((t) => t !== value);
        this.renderSearchTags();
        this.runSearch();
    }

    renderSearchTags() {
        this.searchTagsEl.innerHTML = '';
        this.searchTags.forEach((tag) => {
            const chip = document.createElement('span');
            chip.className = 'search-tag-chip';
            chip.textContent = tag;

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'search-tag-remove';
            remove.textContent = '×';
            remove.addEventListener('click', () => this.removeSearchTag(tag));
            chip.appendChild(remove);

            this.searchTagsEl.appendChild(chip);
        });
    }

    async runSearch() {
        if (this.searchTags.length === 0) {
            this.searchResultsEl.innerHTML = '';
            return;
        }

        const requestId = ++this.searchRequestId;
        this.searchResultsEl.innerHTML = '<div class="search-status">검색 중...</div>';

        try {
            const query = this.searchTags.join(' ');
            const response = await fetch(`/api/pins/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();

            // 태그를 빠르게 추가/삭제하면 응답이 뒤섞여 도착할 수 있으므로, 가장 마지막 요청만 반영한다
            if (requestId !== this.searchRequestId) return;

            this.renderSearchResults(data.pins || []);
        } catch (err) {
            if (requestId !== this.searchRequestId) return;
            this.searchResultsEl.innerHTML = '<div class="search-status">검색에 실패했습니다</div>';
        }
    }

    renderSearchResults(pins) {
        this.searchResultsEl.innerHTML = '';

        if (pins.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'search-status';
            empty.textContent = '일치하는 이미지가 없습니다';
            this.searchResultsEl.appendChild(empty);
            return;
        }

        pins.forEach((pin) => {
            const row = document.createElement('div');
            row.className = 'search-result-row';

            const thumb = document.createElement('img');
            thumb.className = 'search-result-thumb';
            thumb.src = pin.image;
            thumb.alt = '';
            row.appendChild(thumb);

            const title = document.createElement('span');
            title.className = 'search-result-title';
            title.textContent = pin.title && pin.title !== '제목 없음' ? pin.title : (pin.description || '');
            row.appendChild(title);

            row.addEventListener('click', () => this.showDetailPage(pin));
            this.searchResultsEl.appendChild(row);
        });
    }

    onMouseMove(event) {
        if (!this.detailPage.classList.contains('hidden')) return;
        if (this.searchPanel.contains(event.target) || this.searchToggle.contains(event.target)) return;

        this.updateHoverAt(event.clientX, event.clientY);
    }

    onClick(event) {
        // 클릭이 계속 안 되는 원인을 재현 환경에서 못 찾아서, 실제로 재현될 때 콘솔에서
        // 바로 원인을 볼 수 있도록 임시로 남겨두는 진단 로그 - onClick 자체가 호출되는지부터 확인한다
        console.log('[클릭 진단] onClick 호출됨', { x: event.clientX, y: event.clientY, target: event.target && event.target.tagName });

        // 드래그(회전 등) 끝에 발생한 클릭은 카드를 여는 클릭이 아니라 카메라 조작이었을
        // 뿐이므로 무시한다 (실제 클릭은 손이 살짝 떨려도 몇 px 움직이므로 여유 있게 잡는다)
        if (this.mouseDownPos) {
            const dragDistance = Math.hypot(event.clientX - this.mouseDownPos.x, event.clientY - this.mouseDownPos.y);
            if (dragDistance > 10) {
                console.log('[클릭 진단] 드래그로 판단되어 무시', { dragDistance: dragDistance.toFixed(1) });
                return;
            }
        }

        // 삭제 확인 팝업이 열려 있을 때 바깥을 클릭하면 그냥 팝업만 닫는다
        // (그 클릭이 이어서 카드를 열어버리면 혼란스러우므로 거기서 끝낸다)
        if (!this.deleteConfirm.classList.contains('hidden')) {
            console.log('[클릭 진단] 삭제 확인 팝업이 열려있어서 무시');
            if (!this.deleteConfirm.contains(event.target)) this.hideDeleteConfirm();
            return;
        }

        // 상세 페이지가 열려 있을 때: 카드 바깥(뒷배경)을 클릭하면 닫고,
        // 카드 안쪽 클릭(메모 입력, 닫기 버튼 등)은 카드 열기 로직과 무관하므로 무시한다.
        if (this.detailPage.contains(event.target)) {
            console.log('[클릭 진단] 클릭 대상이 상세페이지 내부라서 무시', { isBackdrop: event.target === this.detailPage });
            if (event.target === this.detailPage) this.closeDetailPage();
            return;
        }
        if (this.searchPanel.contains(event.target) || this.searchToggle.contains(event.target)) {
            console.log('[클릭 진단] 클릭 대상이 검색 UI라서 무시');
            return;
        }

        // this.hoveredParticle은 가장 최근 mousemove 시점 기준이라, 상세 페이지를 닫자마자
        // 바로 다시 클릭하는 경우처럼 그 사이 mousemove가 한 번도 없었으면 오래된(stale)
        // 값일 수 있다. 그래서 클릭 시점 좌표(event.clientX/Y, 실제 커서 위치)로 즉시
        // 다시 레이캐스트해서 항상 정확하게 판정한다 - 화살표는 순전히 시각적 보조
        // 표시일 뿐이라 이 판정과는 아무 관계가 없다.
        const intersects = this.raycastCardsNear(event.clientX, event.clientY);
        if (intersects.length === 0) {
            console.log('[클릭 진단] 레이캐스트가 카드에 안 맞음', { x: event.clientX, y: event.clientY, target: event.target && event.target.tagName });
            return;
        }
        console.log('[클릭 진단] 카드 열기 성공');

        const pinData = intersects[0].object.userData.particle.pinData;
        this.showDetailPage(pinData);
    }

    /**
     * 카드가 작고 계속 흘러가듯 움직이다 보니, 눈에는 카드 위를 클릭한 것 같아도
     * 정확한 그 픽셀은 카드와 카드 사이 빈틈이었던 경우가 잦다 - 그러면 레이캐스트가
     * 아무것도 못 맞혀서 "클릭이 안 먹는다"고 느껴진다. 정확한 지점이 빗나가면 바로
     * 주변 몇 곳을 추가로 찔러봐서, 조준이 살짝만 벗어나도 여전히 인식되게 한다.
     */
    raycastCardsNear(clientX, clientY) {
        const tryPoint = (x, y) => {
            const point = new THREE.Vector2(
                (x / window.innerWidth) * 2 - 1,
                -(y / window.innerHeight) * 2 + 1
            );
            this.raycaster.setFromCamera(point, this.camera);
            return this.raycaster.intersectObjects(this.particleGroup.children, true);
        };

        const direct = tryPoint(clientX, clientY);
        if (direct.length > 0) return direct;

        const radius = 14;
        const ringPoints = 8;
        for (let i = 0; i < ringPoints; i++) {
            const angle = (i / ringPoints) * Math.PI * 2;
            const nearby = tryPoint(clientX + Math.cos(angle) * radius, clientY + Math.sin(angle) * radius);
            if (nearby.length > 0) return nearby;
        }
        return [];
    }

    /**
     * 지금 좌표 아래 있는 게 3D 캔버스 자체인지 확인한다. 검색 패널/상세 페이지/버튼 같은
     * 고정 UI는 캔버스 위에 그려지므로, 여기서 false가 나오면 그 UI가 자체 클릭 처리를
     * 하도록 그냥 내버려두고(=터치 핸들러가 손대지 않고) 넘어가야 한다.
     */
    isCanvasTarget(x, y) {
        const target = document.elementFromPoint(x, y);
        return !!target && (target === this.container || target.tagName === 'CANVAS');
    }

    /**
     * 모바일 터치 지원: 마우스가 없는 화면에는 hover가 없으므로, 손가락을 대고 있는
     * 동안을 "호버 중"으로 취급해서 같은 미리보기 로직을 그대로 재사용한다.
     */
    onTouchStart(event) {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        this.touchStartPos = { x: touch.clientX, y: touch.clientY };

        if (!this.isCanvasTarget(touch.clientX, touch.clientY)) return;
        this.updateHoverAt(touch.clientX, touch.clientY);
    }

    onTouchMove(event) {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        if (!this.isCanvasTarget(touch.clientX, touch.clientY)) return;
        this.updateHoverAt(touch.clientX, touch.clientY);
    }

    /**
     * 손가락을 뗀 시점: 많이 움직였으면(카메라를 돌린 것) 탭이 아니므로 무시하고,
     * 캔버스가 아닌 다른 UI(버튼/입력창/링크 등) 위였으면 그쪽이 자기 click으로
     * 알아서 처리하도록 그대로 둔다. 캔버스 위에서의 짧은 탭만 카드 열기로 이어진다.
     */
    onTouchEnd(event) {
        if (this.hoveredParticle) {
            this.setParticleScale(this.hoveredParticle.mesh, 1);
            this.hoveredParticle = null;
        }
        this.hidePreviewPanel();

        const touch = event.changedTouches[0];
        const startPos = this.touchStartPos;
        this.touchStartPos = null;
        if (!touch || !startPos) return;

        if (!this.isCanvasTarget(touch.clientX, touch.clientY)) return;

        // 캔버스 위에서 일어난 터치는 여기서 완전히 처리하고, 뒤이어 브라우저가
        // 합성해서 쏘는 click은 억제한다 (그렇지 않으면 카메라를 돌리는 드래그도
        // 매번 합성 click을 만들어내서 onClick의 드래그 판정을 무력화시킨다).
        event.preventDefault();

        const dragDistance = Math.hypot(touch.clientX - startPos.x, touch.clientY - startPos.y);
        if (dragDistance > 10) return;

        const intersects = this.raycastCardsNear(touch.clientX, touch.clientY);
        if (intersects.length === 0) return;

        const pinData = intersects[0].object.userData.particle.pinData;
        this.showDetailPage(pinData);
    }

    /**
     * onMouseMove의 호버 판정 로직과 동일 - 마우스 좌표 대신 임의의 좌표(터치 지점)를
     * 받아서 그 자리에 카드가 있으면 미리보기를 띄우고, 없으면 닫는다.
     */
    updateHoverAt(clientX, clientY) {
        const intersects = this.raycastCardsNear(clientX, clientY);

        if (this.hoveredParticle) {
            this.setParticleScale(this.hoveredParticle.mesh, 1);
        }

        if (intersects.length > 0) {
            const particle = intersects[0].object.userData.particle;
            this.hoveredParticle = particle;
            this.setParticleScale(particle.mesh, 1.3);
            this.updatePreviewPanel(particle);
        } else {
            this.hoveredParticle = null;
            this.hidePreviewPanel();
        }
    }

    /**
     * 이미지(카드) 위에서 우클릭하면 기본 브라우저 메뉴 대신 삭제 확인 팝업을 띄운다.
     * OrbitControls가 우클릭 드래그로 화면을 이동시키는 것과는 별개로 동작한다
     * (짧게 우클릭만 하는 경우엔 드래그가 없어 화면 이동도 눈에 띄지 않는다).
     */
    onContextMenu(event) {
        if (this.detailPage.contains(event.target)) return;
        if (this.searchPanel.contains(event.target) || this.searchToggle.contains(event.target)) return;
        if (!this.hoveredParticle) return;

        event.preventDefault();
        this.pendingDeleteParticle = this.hoveredParticle;
        this.showDeleteConfirm(event.clientX, event.clientY);
    }

    showDeleteConfirm(x, y) {
        this.deleteConfirm.classList.remove('hidden');

        // 화면 바깥으로 삐져나가지 않도록 위치를 보정한다
        const rect = this.deleteConfirm.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 12;
        const maxY = window.innerHeight - rect.height - 12;
        this.deleteConfirm.style.left = `${Math.min(x, maxX)}px`;
        this.deleteConfirm.style.top = `${Math.min(y, maxY)}px`;
    }

    hideDeleteConfirm() {
        this.deleteConfirm.classList.add('hidden');
        this.pendingDeleteParticle = null;
    }

    async confirmDeletePin() {
        const particle = this.pendingDeleteParticle;
        if (!particle) return;

        this.hideDeleteConfirm();

        try {
            const response = await fetch(`/api/pins/${encodeURIComponent(particle.pinData.id)}`, {
                method: 'DELETE'
            });
            const data = await response.json();
            if (!data.success) throw new Error(data.error || '삭제 실패');
            this.removeParticleFromScene(particle);
        } catch (err) {
            console.error('핀 삭제 실패:', err);
        }
    }

    /**
     * 삭제된 카드를 씬/배열에서 제거하고 GPU 리소스(geometry, texture, material)도 정리한다
     */
    removeParticleFromScene(particle) {
        this.particleGroup.remove(particle.mesh);
        if (particle.mesh.geometry) particle.mesh.geometry.dispose();
        if (particle.mesh.material) {
            if (particle.mesh.material.map) particle.mesh.material.map.dispose();
            particle.mesh.material.dispose();
        }
        this.particles = this.particles.filter((p) => p !== particle);

        if (this.hoveredParticle === particle) {
            this.hoveredParticle = null;
            this.hidePreviewPanel();
        }
    }

    updatePreviewPanel(particle) {
        const pinData = particle.pinData;
        
        // 이미지가 있으면 표시, 없으면 그라디언트 배경
        const previewImg = document.getElementById('preview-image');
        if (pinData.image) {
            previewImg.src = pinData.image;
            previewImg.onerror = () => {
                previewImg.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            };
        } else {
            previewImg.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }
        
        document.getElementById('preview-title').textContent = pinData.title;
        document.getElementById('preview-description').textContent = pinData.description;
        
        this.previewPanel.classList.add('active');
    }

    hidePreviewPanel() {
        this.previewPanel.classList.remove('active');
    }

    showDetailPage(pinData) {
        this.trackRecentlyViewed(pinData);

        // 이미지가 있으면 표시, 없으면 무채색 플레이스홀더
        const detailImg = document.getElementById('detail-image');
        detailImg.style.background = 'none';

        // 이미지의 원본 비율을 알기 전까지는 기본 비율로 카드를 잡아둔다
        this.currentDetailAspect = 4 / 3;

        if (pinData.image) {
            detailImg.onload = () => {
                this.currentDetailAspect = detailImg.naturalWidth / detailImg.naturalHeight;
                this.layoutDetailCard();
            };
            detailImg.onerror = () => {
                detailImg.style.background = '#3a3a3a';
            };
            detailImg.src = pinData.image;
        } else {
            detailImg.removeAttribute('src');
            detailImg.style.background = '#3a3a3a';
        }

        document.getElementById('detail-description').textContent = pinData.description;

        // 상단 바를 실제 브라우저 주소창처럼 보이게, 핀의 링크에서 도메인을 뽑아 보여준다
        const urlEl = document.getElementById('detail-browser-url');
        if (pinData.link) {
            try {
                urlEl.textContent = new URL(pinData.link).hostname.replace(/^www\./, '');
            } catch (err) {
                urlEl.textContent = 'pinterest.com';
            }
        } else {
            urlEl.textContent = 'archive.local';
        }

        const linkEl = document.getElementById('detail-link');
        if (pinData.link) {
            linkEl.href = pinData.link;
            linkEl.style.display = '';
        } else {
            linkEl.style.display = 'none';
        }

        // 키워드: 자동 추출된 태그(제거 불가) + 사용자가 직접 추가한 태그(제거 가능)
        this.currentDetailPinId = pinData.id;
        this.currentDetailAutoTags = pinData.tags || [];
        this.currentDetailCustomTags = (pinData.customTags || []).slice();
        this.renderDetailTags();
        document.getElementById('detail-tag-input').value = '';

        // 메모 입력란: 이 핀에 저장된 메모를 불러와서 채워준다
        this.detailMemo.value = pinData.memo || '';
        document.getElementById('detail-memo-status').textContent = '';

        this.loadRelatedPins(pinData.id);

        this.layoutDetailCard();
        this.detailPage.classList.remove('hidden');
    }

    /**
     * 같은 대범주(+모노크롬/폴리크롬, 메인색)를 가진 다른 핀들을 추천해서
     * 상세 페이지 안에서 바로 이어서 둘러볼 수 있게 한다.
     */
    async loadRelatedPins(pinId) {
        const container = document.getElementById('detail-related');
        const requestId = ++this.relatedRequestId;
        container.innerHTML = '<div class="detail-related-status">불러오는 중...</div>';

        try {
            const response = await fetch(`/api/pins/${encodeURIComponent(pinId)}/related?limit=12`);
            const data = await response.json();
            if (requestId !== this.relatedRequestId) return;

            const pins = data.pins || [];
            container.innerHTML = '';

            if (pins.length === 0) {
                container.innerHTML = '<div class="detail-related-status">관련 이미지가 없습니다</div>';
                return;
            }

            pins.forEach((pin) => {
                const thumb = document.createElement('img');
                thumb.className = 'detail-related-thumb';
                thumb.src = pin.image;
                thumb.alt = '';
                thumb.addEventListener('click', () => this.showDetailPage(pin));
                container.appendChild(thumb);
            });
        } catch (err) {
            if (requestId !== this.relatedRequestId) return;
            container.innerHTML = '';
        }
    }

    closeDetailPage() {
        this.detailPage.classList.add('hidden');
        // 상세 페이지가 열려 있는 동안 호버 갱신이 멈춰 있었으므로, 닫힌 직후엔
        // 오래된(stale) 값을 들고 있지 않도록 비워둔다 - 마우스가 다시 움직이면 새로 채워진다
        this.hoveredParticle = null;
        this.hidePreviewPanel();
    }

    /**
     * 자세히 본 핀을 로컬스토리지에 기록해둔다.
     * 메인 페이지의 상단 필름스트립이 같은 브라우저에서 최근 클릭한 이미지를
     * 우선적으로 보여줄 때 사용한다 (index.html/landing.js가 같은 키를 읽음).
     */
    trackRecentlyViewed(pinData) {
        if (!pinData.image) return;
        try {
            const key = 'recentlyViewedPins';
            let list = JSON.parse(localStorage.getItem(key) || '[]');
            list = list.filter((p) => p.id !== pinData.id);
            list.unshift({
                id: pinData.id,
                image: pinData.image,
                description: pinData.description || '',
                category: pinData.category || null,
                mainColor: pinData.mainColor || null
            });
            localStorage.setItem(key, JSON.stringify(list.slice(0, 30)));
        } catch (err) {
            // 프라이빗 모드 등으로 localStorage를 못 쓰면 그냥 건너뛴다
        }
    }

    /**
     * 이미지의 원본 비율(this.currentDetailAspect)에 맞춰 카드 크기를 계산한다.
     * 정보 패널(메모/키워드)은 이미지 비율과 무관하게 항상 일정한 폭을 유지하고,
     * 이미지 쪽은 원본 비율 그대로 크롭 없이 표시되도록 카드 전체 크기를 정한다.
     */
    layoutDetailCard() {
        const aspect = this.currentDetailAspect || 4 / 3;
        const card = document.querySelector('.detail-card');
        const imageHalf = document.querySelector('.detail-image-half');
        const infoHalf = document.getElementById('detail-info-half');
        // 브라우저 창 흉내를 낸 상단 바의 높이 - style.css의 .detail-browser-bar와 값을 맞춰야 한다
        const barHeight = 40;

        if (window.innerWidth < 768) {
            // 좁은 화면: 이미지 위, 정보 패널 아래로 쌓는다
            const cardWidth = window.innerWidth * 0.92;
            const cardHeight = window.innerHeight * 0.9;
            const bodyHeight = cardHeight - barHeight;
            const infoHeight = Math.min(260, bodyHeight * 0.4);
            const imageHeight = bodyHeight - infoHeight;

            card.style.width = `${cardWidth}px`;
            card.style.height = `${cardHeight}px`;
            imageHalf.style.flexBasis = `${imageHeight}px`;
            infoHalf.style.flexBasis = `${infoHeight}px`;
            return;
        }

        // 정보 패널: 이미지 비율과 무관하게 항상 같은 폭 (화면 크기에 맞춰 살짝만 조정)
        const infoWidth = Math.min(420, Math.max(320, window.innerWidth * 0.26));
        const maxCardWidth = window.innerWidth * 0.94;
        const maxCardHeight = window.innerHeight * 0.88 - barHeight;
        const maxImageWidth = Math.max(280, maxCardWidth - infoWidth);

        // 이미지는 원본 비율을 유지한 채, 세로 기준으로 최대한 키우고
        // 폭이 넘치면 폭 기준으로 다시 줄인다 (크롭 없이 전체가 보이도록)
        let imageWidth = maxCardHeight * aspect;
        let imageHeight = maxCardHeight;
        if (imageWidth > maxImageWidth) {
            imageWidth = maxImageWidth;
            imageHeight = imageWidth / aspect;
        }

        card.style.width = `${imageWidth + infoWidth}px`;
        card.style.height = `${imageHeight + barHeight}px`;
        imageHalf.style.flexBasis = `${imageWidth}px`;
        infoHalf.style.flexBasis = `${infoWidth}px`;
    }

    /**
     * 자동 태그 + 사용자 키워드를 합쳐서 다시 그린다
     */
    renderDetailTags() {
        const tagsContainer = document.getElementById('detail-tags');
        tagsContainer.innerHTML = '';

        this.currentDetailAutoTags.forEach((tag) => {
            const tagEl = document.createElement('span');
            tagEl.className = 'tag tag-auto';
            tagEl.textContent = tag;
            tagsContainer.appendChild(tagEl);
        });

        this.currentDetailCustomTags.forEach((tag, index) => {
            const tagEl = document.createElement('span');
            tagEl.className = 'tag tag-custom';
            tagEl.textContent = tag;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'tag-remove';
            removeBtn.textContent = '×';
            removeBtn.setAttribute('aria-label', `${tag} 삭제`);
            removeBtn.addEventListener('click', () => this.removeDetailTag(index));

            tagEl.appendChild(removeBtn);
            tagsContainer.appendChild(tagEl);
        });
    }

    /**
     * 사용자 키워드 추가/삭제 - 즉시 렌더링하고 서버에 저장한다
     */
    addDetailTag(text) {
        const tag = text.trim();
        if (!tag || this.currentDetailCustomTags.includes(tag)) return;

        this.currentDetailCustomTags.push(tag);
        this.renderDetailTags();
        this.saveDetailTags();
    }

    removeDetailTag(index) {
        this.currentDetailCustomTags.splice(index, 1);
        this.renderDetailTags();
        this.saveDetailTags();
    }

    async saveDetailTags() {
        const pinId = this.currentDetailPinId;
        const tags = this.currentDetailCustomTags.slice();

        try {
            await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: pinId, tags })
            });
            this.particles.forEach((p) => {
                if (p.pinData.id === pinId) p.pinData.customTags = tags.slice();
            });
        } catch (err) {
            console.warn('키워드 저장 실패:', err);
        }
    }

    /**
     * 메모 입력 - 잠시 멈추면(500ms) 서버에 저장한다
     */
    onMemoInput() {
        const pinId = this.currentDetailPinId;
        const memoText = this.detailMemo.value;
        const statusEl = document.getElementById('detail-memo-status');
        statusEl.textContent = '저장 중...';

        clearTimeout(this.memoSaveTimer);
        this.memoSaveTimer = setTimeout(async () => {
            try {
                await fetch('/api/memo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: pinId, memo: memoText })
                });
                // 같은 핀을 가리키는 다른 카드들의 메모리 상의 데이터도 갱신
                this.particles.forEach((p) => {
                    if (p.pinData.id === pinId) p.pinData.memo = memoText;
                });
                statusEl.textContent = '저장됨';
            } catch (err) {
                statusEl.textContent = '저장 실패';
                console.warn('메모 저장 실패:', err);
            }
        }, 500);
    }

    setParticleScale(mesh, scale) {
        mesh.scale.setScalar(scale);
    }

    onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);

        if (!this.detailPage.classList.contains('hidden')) {
            this.layoutDetailCard();
        }
    }

    /**
     * 우측 상단 검색 버튼 쪽을 항상 가리키는 화살표를 매 프레임 갱신한다. 클릭 판정과는
     * 완전히 무관한 순수 시각적 보조 표시일 뿐이다(실제 클릭은 항상 이벤트의 실제 좌표로
     * 직접 계산한다) - 그래서 커서 위치에 딱 붙이거나 촉 끝을 커서에 맞추는 등의 정렬은
     * 하지 않고, 실제 OS 커서와 겹치지 않도록 일정 거리 떨어진 자리에 그린다. 상세 페이지가
     * 열려 있거나 검색 패널/버튼, 아카이브 링크 위에 커서가 있을 땐 굳이 가리킬 필요가
     * 없으니 숨긴다.
     */
    updateSearchPointer() {
        if (!this.searchPointer) return;

        this.pointerPos.x = this.pointerTarget.x;
        this.pointerPos.y = this.pointerTarget.y;

        // 커서와 겹치지 않도록 대각선으로 일정 거리 띄운 자리에 화살표를 그린다
        const CURSOR_OFFSET = 34;
        const anchorX = this.pointerPos.x + CURSOR_OFFSET;
        const anchorY = this.pointerPos.y + CURSOR_OFFSET;

        const rect = this.searchToggle.getBoundingClientRect();
        const targetX = rect.left + rect.width / 2;
        const targetY = rect.top + rect.height / 2;

        const rawAngle = Math.atan2(targetY - anchorY, targetX - anchorX) * 180 / Math.PI;

        // 각도가 -180/180 경계를 넘나들 때 CSS transition이 반대 방향으로 크게
        // 돌아버리는 것을 막기 위해, 이전 각도를 기준으로 가장 가까운 방향으로만 보정한다
        let delta = rawAngle - (this.pointerAngle % 360);
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        this.pointerAngle += delta;

        this.searchPointer.style.left = `${anchorX}px`;
        this.searchPointer.style.top = `${anchorY}px`;
        this.searchPointer.style.transform = `translate(-50%, -50%) rotate(${this.pointerAngle}deg)`;

        // 첫 방문 힌트가 떠 있는 동안, 화살표가 가리키는 방향으로 조금 더 나간 자리에
        // "SEARCH →" 라벨을 같이 따라다니게 한다
        if (this.showPointerHint) {
            const rad = this.pointerAngle * Math.PI / 180;
            this.searchPointerHint.style.left = `${anchorX + Math.cos(rad) * 45}px`;
            this.searchPointerHint.style.top = `${anchorY + Math.sin(rad) * 45}px`;
        }

        // 실제 커서가 검색 버튼/패널이나 아카이브 링크 위에 있거나 상세 페이지가
        // 열려 있으면 굳이 가리킬 필요가 없으니 숨긴다.
        const cursorEl = document.elementFromPoint(this.pointerTarget.x, this.pointerTarget.y);
        const overSearchUi = !!cursorEl && (this.searchToggle.contains(cursorEl) || this.searchPanel.contains(cursorEl));
        const overBackLink = !!cursorEl && this.backHomeLink.contains(cursorEl);
        const shouldShow = this.pointerHasMoved
            && this.detailPage.classList.contains('hidden')
            && !overSearchUi
            && !overBackLink;
        this.searchPointer.classList.toggle('visible', shouldShow);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        this.updateSearchPointer();

        // 입장 연출이 재생되는 동안은 카메라를 그쪽에서 전담하므로 평소 전진/컨트롤 갱신은 건너뛴다
        if (!this.introPlaying) {
            // 빈 배경을 좌클릭하고 있는 동안 목표 배속으로 서서히 가속/감속한다
            const targetDriftMultiplier = this.driftBoostActive ? 6 : 1;
            this.driftBoostMultiplier += (targetDriftMultiplier - this.driftBoostMultiplier) * 0.08;

            // 호버 여부와 상관없이 터널 안쪽으로 항상 서서히 전진한다
            // (카드를 살펴보다가 클릭하는 동안에도 멈추지 않고 계속 흘러감)
            const drift = this.driftSpeed * this.driftBoostMultiplier;
            this.camera.position.z -= drift;
            this.controls.target.z -= drift;

            // 카메라를 지나쳐 뒤로 빠진 카드는 터널 맨 앞쪽으로 되돌려서
            // 끝없이 이어지는 아카이브처럼 보이게 한다 (무한 루프 터널)
            this.particles.forEach((particle) => {
                if (particle.position.z > this.camera.position.z + 4) {
                    particle.baseZ -= this.tunnelDepth;
                    particle.position.z -= this.tunnelDepth;
                    particle.mesh.position.z = particle.position.z;
                }
            });

            // 배경 먼지 조각도 같이 흘러가다가 뒤로 빠지면 앞쪽으로 되돌린다
            const dustDepth = this.tunnelDepth * 1.4;
            this.backgroundDust.forEach((dust) => {
                if (dust.mesh.position.z > this.camera.position.z + 4) {
                    dust.mesh.position.z -= dustDepth;
                }
                dust.mesh.rotation.x += dust.spinX;
                dust.mesh.rotation.y += dust.spinY;
            });

            // 사용자가 드래그/휠로 자유롭게 시점을 바꿀 수 있도록 컨트롤 갱신
            this.controls.update();
        }

        // 호버되지 않은 카드의 스케일을 천천히 원래대로 복원
        this.particles.forEach((particle) => {
            if (particle !== this.hoveredParticle) {
                particle.mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.08);
            }
        });

        this.renderer.render(this.scene, this.camera);
    }
}

// 페이지 로드 후 갤러리 초기화
document.addEventListener('DOMContentLoaded', () => {
    new ParticleGallery();
});
