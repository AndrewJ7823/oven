# Oven — 쿠키 교체 크롬 익스텐션 기능 정의서

| 항목 | 내용 |
|---|---|
| 문서 버전 | 1.0 (2026-08-26) |
| 대상 플랫폼 | Chrome 116+ (Manifest V3, Service Worker 기반) |
| 언어/도구 | TypeScript, Vite, Vitest |

---

## 1. 개요

**Oven**은 외부 애플리케이션(데스크톱 프로그램, 로컬 서버, 웹 앱 등)이 전송한 쿠키 데이터를 받아
현재 Chrome 프로필의 쿠키 저장소에 **교체(upsert / replace)** 해주는 브라우저 익스텐션이다.

### 1.1 배경 및 목적

- 별도 도구(예: 인증 자동화 도구, 테스트 러너, 세션 동기화 프로그램)에서 확보한 로그인 세션 쿠키를
  브라우저에 즉시 반영하여, 사용자가 수동으로 개발자도구에서 쿠키를 편집하는 작업을 없앤다.
- 쿠키 주입 과정을 **검증·인증·로그**가 가능한 단일 통로로 표준화한다.

### 1.2 용어

| 용어 | 정의 |
|---|---|
| 외부 앱 (Client) | 익스텐션에 쿠키 교체 요청을 보내는 주체 |
| 트랜스포트 | 외부 앱 → 익스텐션 사이의 메시지 전달 채널 |
| 코어 핸들러 | 트랜스포트와 무관하게 요청을 검증·인증·처리하는 순수 로직 |
| merge 모드 | 전달된 쿠키만 이름/도메인/경로 기준으로 덮어쓰기 (기본값) |
| replace 모드 | 대상 도메인의 기존 쿠키를 모두 삭제한 뒤 전달된 쿠키를 저장 |

---

## 2. 범위

### 2.1 포함 (In Scope)

- FR-01 ~ FR-11 (3장 참조)
- 두 가지 수신 트랜스포트: `externally_connectable` 메시지, 로컬 WebSocket 클라이언트
- 옵션 페이지(설정 UI) 및 최근 처리 로그 조회

### 2.2 제외 (Out of Scope, 추후 검토)

- Native Messaging 호스트 (`connectNative`) 기반 연동
- 쿠키 **읽기/내보내기** API (`cookies.list`) — 보안상 v1에서는 제공하지 않음
- Firefox / Safari 등 타 브라우저 지원
- Cookie Store 파티셔닝(`partitionKey`) 세부 제어, 시크릿 모드 스토어 지정

---

## 3. 기능 요구사항 (Functional Requirements)

### FR-01 외부 메시지 수신 (externally_connectable)

- manifest의 `externally_connectable.matches` 에 등록된 오리진의 웹 페이지가
  `chrome.runtime.sendMessage(EXTENSION_ID, payload)` 로 요청을 보낼 수 있어야 한다.
- 익스텐션은 `chrome.runtime.onMessageExternal` 로 수신하고, 처리 결과를 `sendResponse` 로 반환한다.
- 허용 오리진은 빌드 시 manifest에서 관리한다(런타임 변경 불가 — Chrome 제약).

### FR-02 로컬 WebSocket 수신

- 옵션에서 활성화하면 서비스 워커가 설정된 URL(기본 `ws://127.0.0.1:8765`)로 WebSocket **클라이언트** 연결을 맺는다.
  (익스텐션은 서버를 열 수 없으므로 외부 앱이 서버 역할을 한다.)
- 수신한 텍스트 프레임을 JSON으로 파싱해 코어 핸들러에 전달하고, 응답을 같은 소켓으로 전송한다.
- 연결이 끊기면 지수 백오프(1s → 최대 30s)로 재연결한다.
- 서비스 워커 유지를 위해 20초 간격으로 `{"type":"ping"}` 하트비트를 송신한다.
- `ws://` 는 loopback(127.0.0.1, localhost, [::1])만 허용하고, 그 외 호스트는 `wss://` 만 허용한다.

### FR-03 요청 메시지 검증

- 모든 요청은 4장의 프로토콜 스키마를 만족해야 하며, 위반 시 `E_INVALID_MESSAGE` 로 거부한다.
- 검증 항목
  - `type` 은 지원 타입(`ping`, `cookies.replace`) 중 하나
  - `requestId` 는 1~128자의 문자열 (선택, 없으면 응답에 `null`)
  - `cookies` 는 1개 이상 500개 이하의 배열
  - 개별 쿠키: `name`(비어있지 않은 문자열, 제어문자/`;`/`=`/공백 불가), `value`(문자열), `domain`(유효 호스트),
    `path`(`/`로 시작, 기본 `/`), `secure`/`httpOnly`/`hostOnly`(boolean), `sameSite` ∈ {`no_restriction`,`lax`,`strict`,`unspecified`},
    `expirationDate`(초 단위 UNIX time, 숫자, 생략 시 세션 쿠키)
  - `sameSite: "no_restriction"` 이면 `secure: true` 필수
  - `__Secure-` 접두어 → `secure: true` 필수, `__Host-` 접두어 → `secure: true`, `path: "/"`, `hostOnly: true` 필수
  - `mode` ∈ {`merge`,`replace`} (기본 `merge`)

### FR-04 인증

- 옵션에 **공유 토큰**이 설정된 경우 요청의 `token` 이 일치해야 한다. 불일치/누락 시 `E_UNAUTHORIZED`.
- 토큰이 비어 있으면 인증을 생략한다(개발용). 옵션 페이지는 이 상태를 경고로 표시한다.
- 토큰 비교는 길이 노출을 줄이기 위해 상수 시간 비교를 사용한다.

### FR-05 도메인 허용 목록

- 옵션의 `allowedDomains` 가 비어 있지 않으면, 요청에 포함된 모든 쿠키 도메인이
  허용 목록의 도메인과 같거나 그 하위 도메인이어야 한다. 위반 시 `E_DOMAIN_NOT_ALLOWED` 로 **요청 전체**를 거부한다.

### FR-06 쿠키 교체 — merge 모드

- 각 쿠키를 `chrome.cookies.set` 으로 저장한다. 같은 (name, domain, path) 쿠키가 있으면 덮어쓴다.
- `url` 은 `secure ? https : http` + 도메인(앞의 `.` 제거) + `path` 로 구성한다.
- `hostOnly: true` 이면 `domain` 을 생략하여 host-only 쿠키로 저장한다.
- `expirationDate` 가 현재 시각 이하이면 저장하지 않고 해당 쿠키를 `failed` 로 보고한다(`E_EXPIRED`).

### FR-07 쿠키 교체 — replace 모드

- 요청에 포함된 도메인 집합을 구한 뒤, 도메인이 **정확히 일치**하는(`example.com` 또는 `.example.com`) 기존 쿠키를 모두 삭제한다.
  (하위 도메인 쿠키는 삭제하지 않는다.)
- 삭제 후 FR-06 절차로 저장한다. 응답에 `removed` 수를 포함한다.

### FR-08 부분 실패 처리

- 쿠키 단위로 `chrome.cookies.set` 실패(반환값 `null` 또는 예외)를 수집하여 `failed[]` 에 담는다.
- 하나가 실패해도 나머지는 계속 처리한다. 모두 성공했을 때만 `ok: true`.

### FR-09 dryRun

- `options.dryRun: true` 면 실제 저장/삭제를 하지 않고 검증 결과와 예정 작업 수(`applied`, `removed`)만 반환한다.

### FR-10 헬스체크

- `type: "ping"` 요청에 `{ ok: true, type: "pong", version }` 으로 응답한다. 인증 없이 허용한다.

### FR-11 옵션 페이지 및 로그

- 설정 항목: 공유 토큰, 허용 도메인 목록, WebSocket 활성화 여부/URL.
- 최근 처리 결과 50건(시각, 트랜스포트, type, ok, applied/removed/failed 수, 오류 코드)을 `chrome.storage.session` 에 보관하고 옵션 페이지에서 표시한다.
- 쿠키 **값**은 로그에 기록하지 않는다.

---

## 4. 메시지 프로토콜

### 4.1 요청 — `cookies.replace`

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

### 4.2 응답

```json
{
  "requestId": "3f1c…",
  "type": "cookies.replace",
  "ok": true,
  "applied": 1,
  "removed": 0,
  "failed": [],
  "dryRun": false
}
```

실패 예:

```json
{
  "requestId": "3f1c…",
  "type": "cookies.replace",
  "ok": false,
  "error": { "code": "E_UNAUTHORIZED", "message": "token mismatch" }
}
```

### 4.3 오류 코드

| 코드 | 의미 | 처리 단위 |
|---|---|---|
| `E_INVALID_MESSAGE` | 스키마 위반 (상세는 `message`) | 요청 |
| `E_UNKNOWN_TYPE` | 지원하지 않는 `type` | 요청 |
| `E_UNAUTHORIZED` | 토큰 불일치 | 요청 |
| `E_DOMAIN_NOT_ALLOWED` | 허용 목록 외 도메인 | 요청 |
| `E_TOO_MANY_COOKIES` | 500개 초과 | 요청 |
| `E_EXPIRED` | 만료 시각이 과거 | 쿠키 |
| `E_SET_FAILED` | `chrome.cookies.set` 실패 | 쿠키 |

### 4.4 `ping`

요청 `{ "type": "ping", "requestId": "…" }` → 응답 `{ "requestId": "…", "type": "pong", "ok": true, "version": "0.1.0" }`

---

## 5. 비기능 요구사항

| ID | 요구사항 |
|---|---|
| NFR-01 | Manifest V3, 서비스 워커 기반. 영구 백그라운드 페이지 사용 금지 |
| NFR-02 | 코어 로직은 `chrome.*` 전역에 직접 의존하지 않고 주입된 인터페이스(`CookieApi`, `SettingsStore`)만 사용 → 단위 테스트 가능 |
| NFR-03 | 요청 500개 처리 시 1초 이내 (로컬 기준) |
| NFR-04 | 쿠키 값은 콘솔/로그/스토리지에 기록하지 않음 |
| NFR-05 | 권한 최소화: `cookies`, `storage`, `alarms` + `host_permissions: <all_urls>` (쿠키 설정 대상 도메인 제한 불가로 불가피, 옵션의 허용 목록으로 보완) |
| NFR-06 | 단위 테스트 커버리지 코어 90% 이상 |

---

## 6. 아키텍처

```
외부 앱 ──(sendMessage)──▶ external-message transport ─┐
외부 앱 ──(WebSocket)────▶ websocket transport ─────────┤
                                                        ▼
                                              core/handler.handleInbound()
                                                validate → auth → allowlist → dispatch
                                                        ▼
                                              core/replacer.replaceCookies(CookieApi)
                                                        ▼
                                              chrome.cookies (실제) / FakeCookies (테스트)
```

디렉터리:

```
src/
  background/index.ts       서비스 워커 엔트리 — 트랜스포트 조립
  core/protocol.ts          타입 + 검증(validateInbound)
  core/cookie-url.ts        쿠키 → URL 변환
  core/cookie-mapper.ts     쿠키 → chrome.cookies.set 상세
  core/replacer.ts          merge/replace 실행
  core/auth.ts              토큰 비교, 도메인 허용 판정
  core/handler.ts           handleInbound (진입점)
  core/settings.ts          설정 스키마/기본값/로드·저장
  core/activity-log.ts      최근 처리 로그
  transports/external-message.ts
  transports/websocket.ts
  options/                  옵션 페이지
test/
  fakes/                    chrome API 페이크 (cookies, storage, runtime)
  core/, transports/        단위 테스트
```

---

## 7. 수용 기준 (Acceptance Criteria) 요약

| ID | 시나리오 | 기대 결과 |
|---|---|---|
| AC-01 | 유효한 merge 요청 1건 | `ok: true, applied: 1`, 쿠키 저장소에 존재 |
| AC-02 | 같은 name/domain/path 쿠키 재전송 | 값이 덮어써지고 개수 증가 없음 |
| AC-03 | replace 모드, 기존 도메인 쿠키 3개 존재 | `removed: 3`, 전달된 쿠키만 남음, 하위 도메인 쿠키는 유지 |
| AC-04 | 토큰 설정 상태에서 토큰 누락 | `E_UNAUTHORIZED`, 저장소 변화 없음 |
| AC-05 | 허용 목록 외 도메인 포함 | `E_DOMAIN_NOT_ALLOWED`, 저장소 변화 없음 |
| AC-06 | 만료된 쿠키 + 정상 쿠키 | `ok: false, applied: 1, failed: [E_EXPIRED]` |
| AC-07 | dryRun | 저장소 변화 없음, `applied` 는 예정 수 |
| AC-08 | `__Host-` 접두어에 domain 쿠키 | `E_INVALID_MESSAGE` |
| AC-09 | ping | `pong` + version |
| AC-10 | WebSocket 끊김 | 백오프 후 재연결, 하트비트 전송 |
