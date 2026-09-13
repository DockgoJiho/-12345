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

        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.hoveredParticle = null;
        this.particles = [];
        this.pinsData = [];
        this.isLoading = true;
        
        this.init();
        this.setupEventListeners();
        this.loadPinsFromAPI();
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
        this.camera.position.set(0, 0, 4);

        // Renderer 설정
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            precision: 'highp'
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // 마우스 드래그로 회전, 휠로 줌, 우클릭 드래그로 이동 - 어느 각도에서든 볼 수 있게 함
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 30;
        this.controls.target.set(0, 0, -8);

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
                console.log(`✓ ${data.pins.length}개의 핀을 로드했습니다 (출처: ${data.source})`);
                this.pinsData = data.pins;
                this.hideLoading();
                this.createParticles();
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

                const particle = {
                    position: new THREE.Vector3(
                        Math.cos(angle) * radius,
                        Math.sin(angle) * radius,
                        z + jitterZ
                    ),
                    baseZ: z + jitterZ,
                    angle,
                    radius,
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
        const dustCount = 220;

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
            // 터널 반경보다 훨씬 바깥, 훨씬 넓은 범위에 성기게 흩뿌린다
            const radius = this.tunnelRadius + 4 + Math.random() * 26;
            const z = -Math.random() * this.tunnelDepth * 1.4;

            const size = 0.35 + Math.random() * 0.6;
            const geometry = new THREE.PlaneGeometry(size, size * (0.7 + Math.random() * 0.5));
            const material = new THREE.MeshBasicMaterial({
                map: dustTexture,
                color: 0xffffff,
                transparent: true,
                opacity: 0.18 + Math.random() * 0.3,
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
     * 이미지를 텍스쳐로 하는 카드 형태의 파티클 생성
     */
    createImageCard(particle, pinData) {
        // 카드 크기 (훨씬 더 큼 - 2배, 실제 이미지가 보이도록)
        // 포켓몬 카드처럼 두께 없는 완전히 평평한 카드로 표현한다
        const cardWidth = 1.7;
        const cardHeight = 1.4;

        const geometry = new THREE.PlaneGeometry(cardWidth, cardHeight);

        // 카드마다 하나의 액센트 색을 정해서, 테두리/캡션 바 등 공통 프레임에 일관되게 사용한다
        // (상세 페이지를 열 때도 같은 색을 재사용하기 위해 particle.pinData에 저장해둔다)
        const accentColors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#00c2b8', '#e8875f'];
        const accentColor = accentColors[Math.floor(Math.random() * accentColors.length)];
        particle.pinData.accentColor = accentColor;

        // 이미지가 로드되기 전에도 동일한 프레임 디자인을 보여준다 (그라디언트 placeholder)
        const canvas = this.renderCardFace(null, pinData, accentColor);
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
                    // 실제 사진도 동일한 프레임 디자인 안에 넣어서 일관된 인터페이스로 보이게 한다
                    const framedCanvas = this.renderCardFace(loadedTexture.image, pinData, accentColor);
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
     */
    renderCardFace(image, pinData, accentColor) {
        // 터널 안에 수백 장이 동시에 존재하므로 해상도를 적당히 낮춰 GPU 메모리를 아낀다
        const width = 320;
        const height = 264; // cardWidth:cardHeight(1.7:1.4)와 동일한 비율

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
        const scale = Math.max(w / iw, h / ih);
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
        
        this.detailClose.addEventListener('click', () => this.closeDetailPage());
        this.detailMemo.addEventListener('input', () => this.onMemoInput());

        const tagInput = document.getElementById('detail-tag-input');
        tagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addDetailTag(tagInput.value);
                tagInput.value = '';
            }
        });
    }

    onMouseMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // Raycaster로 호버 감지 (카드가 앞/뒤 평면 두 장으로 이루어진 그룹이라 recursive 필요)
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.particleGroup.children, true);

        // 이전 호버 파티클 상태 복원
        if (this.hoveredParticle) {
            this.setParticleScale(this.hoveredParticle.mesh, 1);
        }

        if (intersects.length > 0) {
            const hovered = intersects[0].object;
            const particle = hovered.userData.particle;

            this.hoveredParticle = particle;
            this.setParticleScale(particle.mesh, 1.3);

            this.updatePreviewPanel(particle);
        } else {
            // 카드가 아닌 빈 배경 위에서는 미리보기를 닫는다
            this.hoveredParticle = null;
            this.hidePreviewPanel();
        }
    }

    onClick(event) {
        // 상세 페이지 안에서 일어난 클릭(메모 입력, 닫기 버튼 등)은
        // 카드 열기 로직과 무관하므로 무시한다.
        if (this.detailPage.contains(event.target)) return;

        if (!this.hoveredParticle) return;

        const pinData = this.hoveredParticle.pinData;
        this.showDetailPage(pinData);
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
        // 이미지가 있으면 표시, 없으면 카드와 같은 액센트 컬러 그라디언트
        const detailImg = document.getElementById('detail-image');
        const accentColor = pinData.accentColor || '#667eea';
        detailImg.style.background = 'none';

        // 이미지의 원본 비율을 알기 전까지는 기본 비율로 카드를 잡아둔다
        this.currentDetailAspect = 4 / 3;

        if (pinData.image) {
            detailImg.onload = () => {
                this.currentDetailAspect = detailImg.naturalWidth / detailImg.naturalHeight;
                this.layoutDetailCard();
            };
            detailImg.onerror = () => {
                detailImg.style.background = `linear-gradient(135deg, ${accentColor} 0%, #222 100%)`;
            };
            detailImg.src = pinData.image;
        } else {
            detailImg.removeAttribute('src');
            detailImg.style.background = `linear-gradient(135deg, ${accentColor} 0%, #222 100%)`;
        }

        document.getElementById('detail-info-half').style.background = accentColor;
        document.getElementById('detail-description').textContent = pinData.description;

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

        this.layoutDetailCard();
        this.detailPage.classList.remove('hidden');
    }

    closeDetailPage() {
        this.detailPage.classList.add('hidden');
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

        if (window.innerWidth < 768) {
            // 좁은 화면: 이미지 위, 정보 패널 아래로 쌓는다
            const cardWidth = window.innerWidth * 0.92;
            const cardHeight = window.innerHeight * 0.9;
            const infoHeight = Math.min(260, cardHeight * 0.4);
            const imageHeight = cardHeight - infoHeight;

            card.style.flexDirection = 'column';
            card.style.width = `${cardWidth}px`;
            card.style.height = `${cardHeight}px`;
            imageHalf.style.flexBasis = `${imageHeight}px`;
            infoHalf.style.flexBasis = `${infoHeight}px`;
            return;
        }

        card.style.flexDirection = 'row';

        // 정보 패널: 이미지 비율과 무관하게 항상 같은 폭 (화면 크기에 맞춰 살짝만 조정)
        const infoWidth = Math.min(420, Math.max(320, window.innerWidth * 0.26));
        const maxCardWidth = window.innerWidth * 0.94;
        const maxCardHeight = window.innerHeight * 0.88;
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
        card.style.height = `${imageHeight}px`;
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

    animate() {
        requestAnimationFrame(() => this.animate());

        // 호버 여부와 상관없이 터널 안쪽으로 항상 서서히 전진한다
        // (카드를 살펴보다가 클릭하는 동안에도 멈추지 않고 계속 흘러감)
        this.camera.position.z -= this.driftSpeed;
        this.controls.target.z -= this.driftSpeed;

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

        // 호버되지 않은 카드의 스케일을 천천히 원래대로 복원
        this.particles.forEach((particle) => {
            if (particle !== this.hoveredParticle) {
                particle.mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 0.08);
            }
        });

        // 사용자가 드래그/휠로 자유롭게 시점을 바꿀 수 있도록 컨트롤 갱신
        this.controls.update();

        this.renderer.render(this.scene, this.camera);
    }
}

// 페이지 로드 후 갤러리 초기화
document.addEventListener('DOMContentLoaded', () => {
    new ParticleGallery();
});
