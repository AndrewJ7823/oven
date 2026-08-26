# Oven — Cookie Replacer

외부 애플리케이션(데스크톱 프로그램, 로컬 서버, 웹 앱)이 전송한 쿠키를 받아
현재 Chrome 프로필의 쿠키 저장소에 **교체 적용**하는 Manifest V3 크롬 익스텐션.

[![tests](https://img.shields.io/badge/tests-106%20passed-brightgreen)](#개발)
[![coverage](https://img.shields.io/badge/coverage-98%25-brightgreen)](#개발)
![chrome](https://img.shields.io/badge/Chrome-116%2B-blue)
![mv3](https://img.shields.io/badge/Manifest-V3-blue)

- 📄 기능 정의서: [`docs/SPEC.md`](docs/SPEC.md)
- 🧪 TDD 가이드: [`docs/TDD.md`](docs/TDD.md)

---

## 주요 기능

| 기능 | 설명 |
|---|---|
| 두 가지 수신 경로 | `externally_connectable` 메시지(웹 앱용), 로컬 WebSocket 클라이언트(데스크톱 앱용) |
| merge / replace 모드 | merge: 같은 name·domain·path 쿠키만 덮어쓰기(기본) · replace: 대상 도메인 기존 쿠키 삭제 후 저장 |
| 엄격한 검증 | RFC 6265 쿠키 이름, 도메인 형식, `sameSite`/`secure` 조합, `__Secure-`/`__Host-` 접두어 규칙 |
| 인증 · 허용 목록 | 공유 토큰(상수 시간 비교), 도메인 허용 목록으로 교체 대상 제한 |
| 부분 실패 보고 | 쿠키 단위로 `E_EXPIRED` / `E_SET_FAILED` 수집, 나머지는 계속 처리 |
| dryRun | 실제 저장 없이 검증 결과와 예정 작업 수만 반환 |
| 옵션 페이지 | 토큰·허용 도메인·WebSocket 설정, 최근 처리 로그 50건(쿠키 값은 기록하지 않음) |

## 설치

```bash
pnpm install
pnpm build          # → dist/
```

1. `chrome://extensions` → **개발자 모드** ON
2. **압축해제된 확장 프로그램을 로드** → `dist/` 선택
3. 확장 프로그램 **옵션**에서 토큰 / 허용 도메인 / WebSocket 설정 (상단에 익스텐션 ID 표시)

## 사용법

### 요청 형식

```json
{
  "type": "cookies.replace",
  "requestId": "3f1c…",
  "token": "shared-secret",
  "mode": "merge",
  "options": { "dryRun": false },
  "cookies": [
    {
      "name": "session_id",
      "value": "abc123",
      "domain": ".example.com",
      "path": "/",
      "secure": true,
      "httpOnly": true,
      "sameSite": "lax",
      "expirationDate": 1790000000
    }
  ]
}
```

응답:

```json
{ "requestId": "3f1c…", "type": "cookies.replace", "ok": true, "applied": 1, "removed": 0, "failed": [], "dryRun": false }
```

`{"type":"ping"}` 은 인증 없이 `{"type":"pong","ok":true,"version":"0.1.0"}` 을 반환한다.
오류 코드 전체 목록은 [`docs/SPEC.md` 4.3](docs/SPEC.md#43-오류-코드) 참조.

### A. 웹 페이지에서 보내기 (externally_connectable)

`public/manifest.json` 의 `externally_connectable.matches` 에 보내는 쪽 오리진을 등록하고 다시 빌드한다.
(기본값은 `http://localhost/*`, `http://127.0.0.1/*`)

```js
const EXTENSION_ID = '...' // 옵션 페이지 상단
const res = await chrome.runtime.sendMessage(EXTENSION_ID, {
  type: 'cookies.replace',
  requestId: crypto.randomUUID(),
  token: 'shared-secret',
  cookies: [{ name: 'sid', value: 'abc', domain: '.example.com', secure: true, sameSite: 'lax' }],
})
```

### B. 데스크톱 / 로컬 프로세스에서 보내기 (WebSocket)

익스텐션은 서버를 열 수 없으므로 **외부 앱이 WebSocket 서버**(`ws://127.0.0.1:8765`)를 열고,
옵션 페이지에서 **WebSocket 수신**을 켠다. 익스텐션이 클라이언트로 접속하면 같은 JSON 을 텍스트 프레임으로 주고받는다.

- 익스텐션은 20초마다 `{"type":"ping","requestId":"hb-N"}` 하트비트를 보낸다 → 서버는 `{"type":"pong"}` 으로 응답
- 연결이 끊기면 1s → 2s → 4s … 최대 30s 지수 백오프로 재연결
- `ws://` 는 loopback(127.0.0.1 / localhost / [::1])만 허용, 원격 호스트는 `wss://` 만 허용

예제 서버로 바로 확인:

```bash
pnpm ws:example --token shared-secret
```

## 개발

```bash
pnpm test            # 단위 테스트 1회
pnpm test:watch      # TDD 루프
pnpm test:coverage   # 커버리지 (core/transports 90% 임계)
pnpm typecheck
pnpm dev             # vite build --watch
```

개발은 **TDD** 로 진행한다. `docs/SPEC.md` 의 FR/AC 번호를 테스트 `describe` 에 명시하고,
실패하는 테스트 → 최소 구현 → 리팩터 순서를 따른다. 자세한 규칙은 [`docs/TDD.md`](docs/TDD.md).

### 구조

```
src/
  core/            트랜스포트 무관 순수 로직 — chrome.* 미의존, 인터페이스 주입
    protocol.ts      요청 스키마 검증 · 정규화 · 응답 타입
    auth.ts          토큰 비교 · 도메인 허용 판정
    replacer.ts      merge / replace 실행
    handler.ts       검증 → 인증 → 허용 목록 → 실행 진입점
    settings.ts      설정 스키마 · 저장소
    activity-log.ts  처리 로그(값 미포함)
  transports/
    external-message.ts   chrome.runtime.onMessageExternal 어댑터
    websocket.ts          WebSocket 클라이언트(재연결 · 하트비트)
  background/index.ts     서비스 워커 — 유일하게 실제 chrome.* 를 주입
  options/                설정 · 로그 UI
test/
  fakes/           FakeCookies · FakeStorageArea · FakeExternalMessageEvent · FakeWebSocket
  core/, transports/
scripts/
  ws-server-example.mjs   외부 앱 역할 예제 서버
  gen-icons.mjs           아이콘 생성
```

### 처리 흐름

```
외부 앱 ─(sendMessage)─▶ external-message ─┐
외부 앱 ─(WebSocket)───▶ websocket ────────┤
                                            ▼
                               handler: validate → auth → allowlist
                                            ▼
                               replacer: (replace 모드면 삭제) → chrome.cookies.set
```

## 보안 메모

- 쿠키 값은 콘솔·로그·스토리지 어디에도 기록하지 않는다.
- 토큰을 비워두면 인증이 생략된다(개발용). 옵션 페이지가 경고를 표시한다.
- `host_permissions: <all_urls>` 는 쿠키 설정 대상을 사전에 제한할 수 없어 불가피하며, 옵션의 허용 도메인 목록으로 보완한다.

## 라이선스

MIT
