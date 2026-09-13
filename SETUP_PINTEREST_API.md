# Pinterest API 설정 가이드

Pinterest API를 연동하여 실제 저장된 핀을 갤러리에 표시하는 방법입니다.

## 1단계: Pinterest 개발자 계정 생성

1. [Pinterest Developers](https://developers.pinterest.com/console) 방문
2. Pinterest 계정으로 로그인
3. 새 앱 생성 (Create App)

## 2단계: 앱 정보 설정

앱 생성 시 다음 정보를 입력합니다:

- **앱 이름**: Pinterest Particle Gallery
- **앱 설명**: Interactive particle gallery for Pinterest pins
- **앱 웹사이트**: http://localhost:3000
- **리다이렉트 URI**: http://localhost:3000/auth/callback
- **약관 동의**: 체크

## 3단계: Access Token 획득

### 방법 1: 개발자 콘솔에서 직접 (권장)

1. [Pinterest Developers](https://developers.pinterest.com/console) 접속
2. 앱 선택
3. **Generate Token** 클릭
4. 권한(Scopes) 선택:
   - `pins:read` ✓
   - `boards:read` ✓
5. **Generate** 클릭
6. 생성된 **Access Token** 복사

### 방법 2: OAuth 플로우 (나중에 구현 예정)

사용자 인증을 통해 자동으로 토큰을 획득하는 방식입니다.

## 4단계: 환경 변수 설정

프로젝트 루트의 `.env` 파일을 열어서 다음을 입력합니다:

```env
PINTEREST_ACCESS_TOKEN=your_access_token_here
PORT=3000
NODE_ENV=development
```

**예시:**
```env
PINTEREST_ACCESS_TOKEN=pAM123abc456def789xyz...
PORT=3000
NODE_ENV=development
```

## 5단계: 의존성 설치 및 서버 실행

```bash
# npm 패키지 설치
npm install

# 서버 시작
npm start
```

브라우저에서 http://localhost:3000 접속하면 Pinterest 핀들이 로드됩니다!

## 문제 해결

### "401 Unauthorized" 에러
- Access Token이 올바른지 확인
- 토큰이 만료되었을 수 있으니 새로 생성

### "403 Forbidden" 에러
- 권한(Scopes) 확인: `pins:read`, `boards:read` 필수

### "네트워크 에러"
- 서버가 실행 중인지 확인: `npm start`
- 포트 3000이 사용 중이 아닌지 확인

### "이미지가 로드되지 않음"
- 이미지 URL이 HTTPS인지 확인
- Pinterest CDN이 접근 가능한지 확인

## API 엔드포인트

서버 실행 후 다음 엔드포인트를 사용할 수 있습니다:

```bash
# 저장된 모든 핀 가져오기
curl http://localhost:3000/api/pins

# 특정 보드의 핀 가져오기
curl http://localhost:3000/api/board/{boardId}/pins

# 모든 보드 가져오기
curl http://localhost:3000/api/boards

# 핀 검색
curl http://localhost:3000/api/search?query=design

# 서버 상태 확인
curl http://localhost:3000/api/status
```

## 보안 주의사항

⚠️ **중요**: 
- `.env` 파일은 절대 Git에 커밋하지 마세요
- Access Token을 공개하지 마세요
- 프로덕션 배포 시 환경 변수를 안전하게 관리하세요

## 다음 단계

- 더 많은 핀 로드 (페이지네이션 추가)
- 보드별 필터링
- 핀 검색 기능
- 사용자 인증 (OAuth 2.0)
- 저장된 핀 목록 캐싱

## 참고 자료

- [Pinterest API 문서](https://developers.pinterest.com/docs/api/overview/)
- [OAuth 2.0 인증](https://developers.pinterest.com/docs/api/oauth)
- [Scopes](https://developers.pinterest.com/docs/api/overview/#permissions)
