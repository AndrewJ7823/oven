/**
 * `pnpm send` CLI 의 순수 로직 — 인자 파싱, 요청 생성, 세션 진행, 결과 포맷. (FR-14)
 * Node/ws 에 직접 의존하지 않으며 `scripts/send-cookies.mjs` 가 실제 서버를 열어 주입한다.
 */
import type { SameSite } from '../core/cookie-api'
import type { ReplaceMode, OutboundResponse, ReplaceResponse, ErrorResponse } from '../core/protocol'

// ── 타입 ──────────────────────────────────────────────────────────────
export interface CookieInput {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  hostOnly?: boolean
  sameSite?: SameSite
  expirationDate?: number
}

export interface SendOptions {
  domain: string
  cookies: CookieInput[]
  jsonFile?: string
  token?: string
  open?: string
  focused: boolean
  mode: ReplaceMode
  dryRun: boolean
  path: string
  secure: boolean
  httpOnly: boolean
  hostOnly: boolean
  sameSite: SameSite
  expirationDate?: number
  requestId?: string
  host: string
  port: number
  timeoutMs: number
}

export type ParseResult =
  | { ok: true; help: true }
  | { ok: true; help: false; options: SendOptions }
  | { ok: false; message: string }

export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, NO_CONNECTION: 3 } as const

const SAME_SITE_VALUES: readonly SameSite[] = ['no_restriction', 'lax', 'strict', 'unspecified']
const MODES: readonly ReplaceMode[] = ['merge', 'replace']

export const USAGE = `사용법: pnpm send --domain <host> [옵션] name=value [name=value ...]

익스텐션이 접속할 로컬 WebSocket 서버를 열고, 접속 즉시 cookies.replace 요청을 보낸 뒤 응답을 출력한다.
(옵션 페이지에서 WebSocket 수신을 켜고 URL 을 ws://<host>:<port> 로 맞춰 둔다.)

쿠키 입력 (하나 이상)
  name=value ...              위치 인자. 첫 "=" 기준으로 이름/값을 나눈다
  --cookie-string "a=1; b=2"  Cookie 헤더 형식
  --json <file|->             쿠키 배열(또는 {"cookies":[...]}) JSON 파일. "-" 는 stdin

대상
  -d, --domain <host>         쿠키 도메인 (예: .example.com). --json 항목의 domain 기본값
  --path </>                  경로 (기본 /)
  --secure / --http-only / --host-only
  --same-site <lax|strict|no_restriction|unspecified>   (기본 lax)
  --expires <N|Ns|Nm|Nh|Nd|ISO8601>   만료. 숫자/접미어는 지금부터의 상대 시간. 생략 시 세션 쿠키

요청
  -t, --token <secret>        공유 토큰 (환경 변수 OVEN_TOKEN 도 사용)
  -o, --open <url>            그 주소로 새 창 열기 → 쿠키 주입 → 새로고침
  --no-focus                  열린 창에 포커스를 주지 않음
  --mode <merge|replace>      (기본 merge)
  --dry-run                   저장하지 않고 검증·예정 작업 수만 확인
  --request-id <id>

연결
  --host <127.0.0.1>  --port <8765>   서버 바인딩 (익스텐션 옵션의 WebSocket URL 과 일치)
  --timeout <ms>              접속·응답 대기 시간 (기본 30000)
  -h, --help

종료 코드: 0 성공 · 1 익스텐션이 실패를 보고 · 2 인자 오류 · 3 접속/응답 시간 초과`

// ── 쿠키 입력 파서 ────────────────────────────────────────────────────
function splitPair(raw: string): CookieInput {
  const eq = raw.indexOf('=')
  const name = eq < 0 ? '' : raw.slice(0, eq).trim()
  if (eq < 0 || name.length === 0) throw new Error(`cookie must be in name=value form: "${raw}"`)
  return { name, value: raw.slice(eq + 1) }
}

/** 위치 인자 `name=value` 목록 → 쿠키. 빈 항목은 무시한다. */
export function parseCookiePairs(pairs: string[]): CookieInput[] {
  return pairs.map((p) => p.trim()).filter((p) => p.length > 0).map(splitPair)
}

/** `Cookie:` 헤더 형식(`a=1; b=2`) → 쿠키 */
export function parseCookieHeader(header: string): CookieInput[] {
  return parseCookiePairs(header.split(';'))
}

/** JSON 텍스트(`[...]` 또는 `{"cookies":[...]}`) → 쿠키. domain 이 없으면 기본 도메인을 채운다. */
export function parseCookiesJson(text: string, defaultDomain: string): CookieInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('--json: file is not valid JSON')
  }
  const arr = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed['cookies']) ? (parsed['cookies'] as unknown[]) : null
  if (!arr) throw new Error('--json: expected an array or { "cookies": [...] }')
  return arr.map((c, i) => {
    if (!isRecord(c)) throw new Error(`--json: cookies[${i}] must be an object`)
    return { ...(c as unknown as CookieInput), domain: typeof c['domain'] === 'string' ? (c['domain'] as string) : defaultDomain }
  })
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ── --expires ────────────────────────────────────────────────────────
const RELATIVE_RE = /^(\d+)([smhd]?)$/
const UNIT_SECONDS: Record<string, number> = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }

/** `3600`, `90s`, `30m`, `2h`, `1d` (now 기준 상대) 또는 ISO 8601 절대 시각 → UNIX 초 */
export function parseExpires(input: string, now: number): number {
  const m = RELATIVE_RE.exec(input.trim())
  if (m) return now + Number(m[1]) * (UNIT_SECONDS[m[2] ?? ''] ?? 1)
  const ms = /^\d{4}-\d{2}-\d{2}/.test(input.trim()) ? Date.parse(input) : NaN
  if (!Number.isFinite(ms)) throw new Error(`--expires: use seconds, 30m/2h/1d, or an ISO-8601 date: "${input}"`)
  return Math.floor(ms / 1000)
}

// ── 인자 파싱 ─────────────────────────────────────────────────────────
const ALIASES: Record<string, string> = { '-d': '--domain', '-t': '--token', '-o': '--open', '-h': '--help' }
const VALUE_OPTIONS = new Set([
  '--domain', '--token', '--open', '--mode', '--path', '--same-site', '--expires', '--request-id', '--host', '--port', '--timeout', '--cookie-string', '--json',
])
const FLAG_OPTIONS = new Set(['--dry-run', '--secure', '--http-only', '--host-only', '--no-focus', '--help'])

function parseInteger(name: string, raw: string, min: number, max: number): number {
  const n = Number(raw)
  if (!/^\d+$/.test(raw) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}: "${raw}"`)
  return n
}

/**
 * process.argv.slice(2) 를 SendOptions 로 변환한다. 실패는 예외 대신 { ok:false, message } 로 돌려준다.
 * @param env  토큰 기본값(OVEN_TOKEN)을 읽을 환경 변수
 * @param now  --expires 상대 시간의 기준(UNIX 초)
 */
export function parseSendArgs(argv: string[], env: Record<string, string | undefined> = {}, now: number = Math.floor(Date.now() / 1000)): ParseResult {
  const positional: string[] = []
  const values: Record<string, string> = {}
  const flags = new Set<string>()

  try {
    for (let i = 0; i < argv.length; i++) {
      const raw = argv[i] as string
      const opt = ALIASES[raw] ?? raw
      if (!opt.startsWith('-') || opt === '-') {
        positional.push(raw)
        continue
      }
      if (FLAG_OPTIONS.has(opt)) {
        flags.add(opt)
        continue
      }
      if (!VALUE_OPTIONS.has(opt)) throw new Error(`unknown option: ${raw}`)
      const v = argv[i + 1]
      if (v === undefined) throw new Error(`${opt} requires a value`)
      values[opt] = v
      i++
    }

    if (flags.has('--help')) return { ok: true, help: true }

    const domain = values['--domain']
    if (!domain) throw new Error('--domain <host> is required')

    const cookies = [...parseCookiePairs(positional), ...(values['--cookie-string'] !== undefined ? parseCookieHeader(values['--cookie-string']) : [])]
    const jsonFile = values['--json']
    if (cookies.length === 0 && jsonFile === undefined) throw new Error('at least one cookie is required (name=value, --cookie-string, or --json)')

    const mode = (values['--mode'] ?? 'merge') as ReplaceMode
    if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join('|')}`)

    const sameSite = (values['--same-site'] ?? 'lax') as SameSite
    if (!SAME_SITE_VALUES.includes(sameSite)) throw new Error(`--same-site must be one of ${SAME_SITE_VALUES.join('|')}`)

    const path = values['--path'] ?? '/'
    if (!path.startsWith('/')) throw new Error('--path must start with "/"')

    const options: SendOptions = {
      domain,
      cookies,
      focused: !flags.has('--no-focus'),
      mode,
      dryRun: flags.has('--dry-run'),
      path,
      secure: flags.has('--secure'),
      httpOnly: flags.has('--http-only'),
      hostOnly: flags.has('--host-only'),
      sameSite,
      host: values['--host'] ?? '127.0.0.1',
      port: values['--port'] !== undefined ? parseInteger('--port', values['--port'], 1, 65535) : 8765,
      timeoutMs: values['--timeout'] !== undefined ? parseInteger('--timeout', values['--timeout'], 1, 3_600_000) : 30_000,
    }
    if (jsonFile !== undefined) options.jsonFile = jsonFile
    const token = values['--token'] ?? env['OVEN_TOKEN']
    if (token !== undefined) options.token = token
    if (values['--open'] !== undefined) options.open = values['--open']
    if (values['--expires'] !== undefined) options.expirationDate = parseExpires(values['--expires'], now)
    if (values['--request-id'] !== undefined) options.requestId = values['--request-id']

    return { ok: true, help: false, options }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

// ── 요청 생성 ─────────────────────────────────────────────────────────
export interface ReplaceRequestPayload {
  type: 'cookies.replace'
  requestId: string
  token?: string
  mode: ReplaceMode
  options: { dryRun: boolean }
  open?: { url: string; focused: boolean }
  cookies: Required<Omit<CookieInput, 'expirationDate'>>[] & { expirationDate?: number }[]
}

/** 옵션의 공통 플래그를 각 쿠키에 적용해 cookies.replace 요청을 만든다. 개별 쿠키 필드가 우선한다. */
export function buildReplaceRequest(opts: SendOptions, ctx: { requestId: string }): ReplaceRequestPayload {
  const cookies = opts.cookies.map((c) => {
    const hostOnly = c.hostOnly ?? opts.hostOnly
    const sameSite = c.sameSite ?? opts.sameSite
    const rawDomain = c.domain ?? opts.domain
    const domain = hostOnly ? rawDomain.replace(/^\./, '') : rawDomain
    const secure = (c.secure ?? opts.secure) || sameSite === 'no_restriction'
    const expirationDate = c.expirationDate ?? opts.expirationDate
    return {
      name: c.name,
      value: c.value,
      domain,
      path: c.path ?? opts.path,
      secure,
      httpOnly: c.httpOnly ?? opts.httpOnly,
      hostOnly,
      sameSite,
      ...(expirationDate !== undefined ? { expirationDate } : {}),
    }
  })

  return {
    type: 'cookies.replace',
    requestId: opts.requestId ?? ctx.requestId,
    ...(opts.token !== undefined ? { token: opts.token } : {}),
    mode: opts.mode,
    options: { dryRun: opts.dryRun },
    ...(opts.open !== undefined ? { open: { url: opts.open, focused: opts.focused } } : {}),
    cookies,
  }
}

// ── 세션 진행 ─────────────────────────────────────────────────────────
/** 접속된 한 소켓에 대한 최소 인터페이스. ws 의 WebSocket 또는 테스트 페이크가 구현한다. */
export interface SessionSocket {
  send(data: string): void
  onMessage(cb: (data: string) => void): void
  onClose(cb: () => void): void
}

/**
 * 접속 직후 요청을 보내고, 하트비트 ping 에는 pong 으로 응답하며,
 * 같은 requestId(또는 requestId 없는 오류) 응답이 오면 resolve 한다. 시간 초과/연결 종료는 reject.
 */
export function runSendSession(socket: SessionSocket, request: ReplaceRequestPayload, opts: { timeoutMs: number }): Promise<OutboundResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(() => reject(new Error(`timed out after ${opts.timeoutMs}ms waiting for the extension's response`))), opts.timeoutMs)

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    socket.onMessage((data) => {
      let msg: unknown
      try {
        msg = JSON.parse(data)
      } catch {
        return
      }
      if (!isRecord(msg)) return
      if (msg['type'] === 'ping') {
        socket.send(JSON.stringify({ requestId: msg['requestId'] ?? null, type: 'pong', ok: true }))
        return
      }
      const id = msg['requestId']
      const isOurs = id === request.requestId
      const isAnonymousError = (id === null || id === undefined) && msg['ok'] === false
      if (isOurs || isAnonymousError) finish(() => resolve(msg as unknown as OutboundResponse))
    })
    socket.onClose(() => finish(() => reject(new Error('connection closed before the extension responded'))))

    socket.send(JSON.stringify(request))
  })
}

// ── 결과 출력 ─────────────────────────────────────────────────────────
export interface FormattedResult {
  exitCode: number
  lines: string[]
}

const isErrorResponse = (r: Record<string, unknown>): r is ErrorResponse & Record<string, unknown> => r['ok'] === false && isRecord(r['error'])
const isReplaceResponse = (r: Record<string, unknown>): r is ReplaceResponse & Record<string, unknown> =>
  r['type'] === 'cookies.replace' && typeof r['applied'] === 'number' && Array.isArray(r['failed'])

/** 익스텐션 응답 → 사람이 읽을 요약 줄과 종료 코드. 쿠키 값은 출력하지 않는다. (NFR-04) */
export function formatResult(response: unknown): FormattedResult {
  if (!isRecord(response)) return { exitCode: EXIT.FAILED, lines: ['unexpected response: ' + JSON.stringify(response)] }

  if (isErrorResponse(response)) {
    return { exitCode: EXIT.FAILED, lines: [`✗ ${response.error.code}: ${response.error.message}`] }
  }
  if (isReplaceResponse(response)) {
    const lines: string[] = []
    const tag = response.dryRun ? ' (dry-run)' : ''
    lines.push(`${response.ok ? '✓' : '✗'} applied ${response.applied}, removed ${response.removed}, failed ${response.failed.length}${tag}`)
    for (const f of response.failed) lines.push(`  - ${f.code} ${f.name} @ ${f.domain}${f.path}: ${f.message}`)
    if (response.opened) {
      const o = response.opened
      lines.push(`  opened ${o.url} → ${o.tabId === null ? 'no tab' : `tab ${o.tabId}`}, ${o.reloaded ? 'reloaded' : 'not reloaded'}`)
    }
    return { exitCode: response.ok ? EXIT.OK : EXIT.FAILED, lines }
  }
  return { exitCode: EXIT.FAILED, lines: ['unexpected response: ' + JSON.stringify(response)] }
}
