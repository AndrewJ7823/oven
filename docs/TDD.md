# TDD 개발 가이드

## 원칙

1. **Red** — `docs/SPEC.md` 의 FR/AC 항목 하나를 골라 실패하는 테스트를 먼저 작성한다.
2. **Green** — 테스트를 통과시키는 최소 구현을 한다.
3. **Refactor** — 테스트가 초록인 상태에서 구조를 정리한다.
4. 커밋 단위는 "테스트 + 구현" 한 쌍. 테스트 없는 프로덕션 코드는 머지하지 않는다.

## 테스트 계층

| 계층 | 대상 | 도구 | `chrome.*` 처리 |
|---|---|---|---|
| 단위 | `src/core/**` | Vitest (node 환경) | 주입 인터페이스 + `test/fakes` |
| 단위 | `src/transports/**` | Vitest | `FakeRuntime`, `FakeWebSocket` 주입 |
| 단위 | `src/cli/**` | Vitest | 의존 없음(순수) — `SessionSocket` 페이크 주입 |
| 통합 | `scripts/send-cookies.mjs` ↔ 코어 | Vitest (CLI 자식 프로세스 + 실제 핸들러·`WebSocketTransport`) | `test/fakes` |
| 수동/E2E | 빌드된 익스텐션 | Chrome 개발자 모드 + `pnpm send` / `scripts/ws-server-example.mjs` | 실제 API |

코어는 `globalThis.chrome` 을 직접 참조하지 않는다. 오직 `background/index.ts` 만 실제 `chrome.*` 를 어댑터로 감싸 주입한다.

## 명령

```bash
pnpm test          # 1회 실행
pnpm test:watch    # 파일 변경 시 재실행 (TDD 루프)
pnpm test:coverage # 커버리지 (코어 90% 목표)
pnpm typecheck
pnpm build         # dist/ 생성 → chrome://extensions 에서 로드
pnpm release patch # 버전 올리기 → CHANGELOG → 커밋 → 태그 (push 하면 GitHub Release 생성)
```

## 테스트 ↔ 요구사항 매핑 규칙

- 테스트 `describe` 이름에 FR/AC 번호를 넣는다. 예: `describe('FR-06 merge 모드', …)`
- 새 요구사항이 생기면 SPEC.md 에 먼저 추가하고 번호를 부여한 뒤 테스트를 작성한다.

## 페이크 사용법

```ts
import { FakeCookies } from '../fakes/cookies'
const cookies = new FakeCookies()
cookies.seed({ name: 'a', value: '1', domain: '.example.com', path: '/' })
await replaceCookies(cookies, request, { now: () => 1_700_000_000 })
expect(cookies.all()).toHaveLength(1)
```

시간은 항상 `now` 를 주입하여 결정적으로 만든다. `Date.now()` 를 코어에서 직접 호출하지 않는다.
