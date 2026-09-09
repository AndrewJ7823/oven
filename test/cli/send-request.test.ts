import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseSendArgs,
  parseCookiePairs,
  parseCookieHeader,
  parseCookiesJson,
  parseExpires,
  buildReplaceRequest,
  runSendSession,
  formatResult,
  EXIT,
  type SendOptions,
  type SessionSocket,
} from '../../src/cli/send-request'

const NOW = 1_800_000_000

const base = (over: Partial<SendOptions> = {}): SendOptions => ({
  domain: '.example.com',
  cookies: [{ name: 'sid', value: 'abc' }],
  path: '/',
  secure: false,
  httpOnly: false,
  hostOnly: false,
  sameSite: 'lax',
  mode: 'merge',
  dryRun: false,
  focused: true,
  host: '127.0.0.1',
  port: 8765,
  timeoutMs: 30_000,
  ...over,
})

describe('FR-14 pnpm send — 인자 파싱', () => {
  it('--domain 과 name=value 위치 인자로 쿠키를 만든다', () => {
    const r = parseSendArgs(['--domain', '.example.com', 'sid=abc', 'theme=dark'])
    expect(r).toMatchObject({
      ok: true,
      options: {
        domain: '.example.com',
        cookies: [
          { name: 'sid', value: 'abc' },
          { name: 'theme', value: 'dark' },
        ],
        mode: 'merge',
        dryRun: false,
        path: '/',
        sameSite: 'lax',
        host: '127.0.0.1',
        port: 8765,
      },
    })
  })

  it('짧은 별칭(-d, -t, -o)과 각종 플래그를 인식한다', () => {
    const r = parseSendArgs([
      '-d', 'example.com', '-t', 'secret', '-o', 'https://example.com/app',
      '--mode', 'replace', '--dry-run', '--secure', '--http-only', '--host-only',
      '--same-site', 'strict', '--path', '/api', '--no-focus',
      '--host', 'localhost', '--port', '9000', '--timeout', '5000', '--request-id', 'req-1',
      'a=1',
    ])
    expect(r).toMatchObject({
      ok: true,
      options: {
        domain: 'example.com', token: 'secret', open: 'https://example.com/app', mode: 'replace', dryRun: true,
        secure: true, httpOnly: true, hostOnly: true, sameSite: 'strict', path: '/api', focused: false,
        host: 'localhost', port: 9000, timeoutMs: 5000, requestId: 'req-1',
      },
    })
  })

  it('값에 "=" 가 포함되어도 첫 "=" 기준으로만 나눈다', () => {
    const r = parseSendArgs(['-d', 'x.com', 'jwt=a.b==c'])
    expect(r.ok && !r.help && r.options.cookies).toEqual([{ name: 'jwt', value: 'a.b==c' }])
  })

  it('--cookie-string 으로 Cookie 헤더 형식을 받는다', () => {
    const r = parseSendArgs(['-d', 'x.com', '--cookie-string', 'a=1; b=2;c=3'])
    expect(r.ok && !r.help && r.options.cookies).toEqual([{ name: 'a', value: '1' }, { name: 'b', value: '2' }, { name: 'c', value: '3' }])
  })

  it('--json 파일 경로는 그대로 전달하고 쿠키 없이도 통과한다', () => {
    const r = parseSendArgs(['-d', 'x.com', '--json', 'cookies.json'])
    expect(r).toMatchObject({ ok: true, options: { jsonFile: 'cookies.json', cookies: [] } })
  })

  it('--token 이 없으면 OVEN_TOKEN 환경 변수를 사용한다', () => {
    const r = parseSendArgs(['-d', 'x.com', 'a=1'], { OVEN_TOKEN: 'from-env' })
    expect(r.ok && !r.help && r.options.token).toBe('from-env')
  })

  it('--expires 는 now 기준 절대 시각(초)으로 변환된다', () => {
    const r = parseSendArgs(['-d', 'x.com', 'a=1', '--expires', '1h'], {}, NOW)
    expect(r.ok && !r.help && r.options.expirationDate).toBe(NOW + 3600)
  })

  it('--help 는 help: true 를 돌려준다', () => {
    expect(parseSendArgs(['--help'])).toMatchObject({ ok: true, help: true })
    expect(parseSendArgs(['-h'])).toMatchObject({ ok: true, help: true })
  })

  it.each([
    [['a=1'], /--domain/],
    [['-d', 'x.com'], /cookie/i],
    [['-d', 'x.com', 'novalue'], /name=value/],
    [['-d', 'x.com', '=v'], /name=value/],
    [['-d', 'x.com', 'a=1', '--mode', 'upsert'], /mode/],
    [['-d', 'x.com', 'a=1', '--same-site', 'none'], /same-site/],
    [['-d', 'x.com', 'a=1', '--port', 'abc'], /port/],
    [['-d', 'x.com', 'a=1', '--timeout', '-1'], /timeout/],
    [['-d', 'x.com', 'a=1', '--path', 'api'], /path/],
    [['-d', 'x.com', 'a=1', '--expires', 'soon'], /expires/],
    [['-d', 'x.com', 'a=1', '--bogus'], /unknown option/i],
    [['-d'], /--domain requires a value/],
  ])('잘못된 인자 %j → 오류 메시지 %s', (argv, re) => {
    const r = parseSendArgs(argv)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(re)
  })
})

describe('FR-14 pnpm send — 쿠키 입력 파서', () => {
  it('parseCookiePairs: 공백 트림, 빈 항목 무시', () => {
    expect(parseCookiePairs([' a=1 ', '', 'b= 2'])).toEqual([{ name: 'a', value: '1' }, { name: 'b', value: ' 2' }])
  })
  it('parseCookieHeader: 세미콜론 구분, 빈 조각 무시', () => {
    expect(parseCookieHeader('a=1; ; b=2;')).toEqual([{ name: 'a', value: '1' }, { name: 'b', value: '2' }])
  })
  it('parseCookieHeader: name 없는 조각은 예외', () => {
    expect(() => parseCookieHeader('a=1; =2')).toThrow(/name=value/)
  })
  it('parseCookiesJson: 배열 또는 { cookies: [...] } 를 받고 도메인 기본값을 채운다', () => {
    const arr = parseCookiesJson('[{"name":"a","value":"1"},{"name":"b","value":"2","domain":"other.com","secure":true}]', '.x.com')
    expect(arr).toEqual([
      { name: 'a', value: '1', domain: '.x.com' },
      { name: 'b', value: '2', domain: 'other.com', secure: true },
    ])
    expect(parseCookiesJson('{"cookies":[{"name":"a","value":"1"}]}', 'x.com')).toEqual([{ name: 'a', value: '1', domain: 'x.com' }])
  })
  it('parseCookiesJson: JSON 이 아니거나 배열이 아니면 예외', () => {
    expect(() => parseCookiesJson('nope', 'x.com')).toThrow(/JSON/)
    expect(() => parseCookiesJson('{"a":1}', 'x.com')).toThrow(/array/)
    expect(() => parseCookiesJson('[1]', 'x.com')).toThrow(/object/)
  })
})

describe('FR-14 pnpm send — --expires 파싱', () => {
  it.each([
    ['3600', NOW + 3600],
    ['90s', NOW + 90],
    ['30m', NOW + 1800],
    ['2h', NOW + 7200],
    ['1d', NOW + 86400],
    ['2026-01-01T00:00:00Z', Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000)],
  ])('%s → %d', (input, expected) => {
    expect(parseExpires(input, NOW)).toBe(expected)
  })
  it.each(['', 'soon', '-5', '1w', '2026-13-45'])('%s 는 예외', (input) => {
    expect(() => parseExpires(input, NOW)).toThrow()
  })
})

describe('FR-14 pnpm send — 요청 생성', () => {
  it('옵션을 cookies.replace 요청으로 변환한다 (도메인/플래그를 모든 쿠키에 적용)', () => {
    const req = buildReplaceRequest(
      base({ cookies: [{ name: 'a', value: '1' }, { name: 'b', value: '2' }], token: 'tk', open: 'https://x.com/', focused: false, secure: true, expirationDate: NOW + 10 }),
      { requestId: 'rid' },
    )
    expect(req).toEqual({
      type: 'cookies.replace',
      requestId: 'rid',
      token: 'tk',
      mode: 'merge',
      options: { dryRun: false },
      open: { url: 'https://x.com/', focused: false },
      cookies: [
        { name: 'a', value: '1', domain: '.example.com', path: '/', secure: true, httpOnly: false, hostOnly: false, sameSite: 'lax', expirationDate: NOW + 10 },
        { name: 'b', value: '2', domain: '.example.com', path: '/', secure: true, httpOnly: false, hostOnly: false, sameSite: 'lax', expirationDate: NOW + 10 },
      ],
    })
  })

  it('token/open/expirationDate 가 없으면 필드를 넣지 않는다', () => {
    const req = buildReplaceRequest(base(), { requestId: 'rid' })
    expect(req).not.toHaveProperty('token')
    expect(req).not.toHaveProperty('open')
    expect(req.cookies[0]).not.toHaveProperty('expirationDate')
  })

  it('옵션의 requestId 를 우선 사용한다', () => {
    expect(buildReplaceRequest(base({ requestId: 'mine' }), { requestId: 'gen' }).requestId).toBe('mine')
  })

  it('--json 으로 들어온 쿠키의 개별 필드는 공통 플래그를 덮어쓴다', () => {
    const req = buildReplaceRequest(base({ cookies: [{ name: 'a', value: '1', domain: 'other.com', secure: true, path: '/p' }] }), { requestId: 'r' })
    expect(req.cookies[0]).toMatchObject({ domain: 'other.com', secure: true, path: '/p', httpOnly: false })
  })

  it('--host-only 이면 도메인 앞의 "." 을 제거한다', () => {
    const req = buildReplaceRequest(base({ hostOnly: true, domain: '.example.com' }), { requestId: 'r' })
    expect(req.cookies[0]).toMatchObject({ domain: 'example.com', hostOnly: true })
  })

  it('sameSite=no_restriction 이면 secure 를 강제한다', () => {
    const req = buildReplaceRequest(base({ sameSite: 'no_restriction', secure: false }), { requestId: 'r' })
    expect(req.cookies[0]).toMatchObject({ sameSite: 'no_restriction', secure: true })
  })
})

class FakeSessionSocket implements SessionSocket {
  sent: unknown[] = []
  private onMsg: ((data: string) => void) | null = null
  private onCls: (() => void) | null = null
  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  onMessage(cb: (data: string) => void): void {
    this.onMsg = cb
  }
  onClose(cb: () => void): void {
    this.onCls = cb
  }
  receive(msg: unknown): void {
    this.onMsg?.(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  close(): void {
    this.onCls?.()
  }
}

describe('FR-14 pnpm send — 세션 진행', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const request = buildReplaceRequest(base(), { requestId: 'rid' })

  it('접속 직후 요청을 보내고, 같은 requestId 응답으로 resolve 한다', async () => {
    const sock = new FakeSessionSocket()
    const p = runSendSession(sock, request, { timeoutMs: 1000 })
    expect(sock.sent).toEqual([request])
    const response = { requestId: 'rid', type: 'cookies.replace', ok: true, applied: 1, removed: 0, failed: [], dryRun: false }
    sock.receive(response)
    await expect(p).resolves.toEqual(response)
  })

  it('익스텐션의 ping 하트비트에는 pong 으로 답하고 계속 기다린다', async () => {
    const sock = new FakeSessionSocket()
    const p = runSendSession(sock, request, { timeoutMs: 1000 })
    sock.receive({ type: 'ping', requestId: 'hb-1' })
    expect(sock.sent[1]).toEqual({ requestId: 'hb-1', type: 'pong', ok: true })
    sock.receive({ requestId: 'rid', type: 'cookies.replace', ok: true, applied: 1, removed: 0, failed: [], dryRun: false })
    await expect(p).resolves.toMatchObject({ ok: true })
  })

  it('다른 requestId 나 JSON 이 아닌 프레임은 무시한다', async () => {
    const sock = new FakeSessionSocket()
    const p = runSendSession(sock, request, { timeoutMs: 1000 })
    sock.receive('not json')
    sock.receive({ requestId: 'other', type: 'cookies.replace', ok: true })
    sock.receive({ requestId: 'rid', type: 'cookies.replace', ok: false, error: { code: 'E_UNAUTHORIZED', message: 'token mismatch' } })
    await expect(p).resolves.toMatchObject({ ok: false, error: { code: 'E_UNAUTHORIZED' } })
  })

  it('requestId 없는 오류 응답(E_INVALID_MESSAGE 등)도 응답으로 받는다', async () => {
    const sock = new FakeSessionSocket()
    const p = runSendSession(sock, request, { timeoutMs: 1000 })
    sock.receive({ requestId: null, type: 'cookies.replace', ok: false, error: { code: 'E_INVALID_MESSAGE', message: 'bad' } })
    await expect(p).resolves.toMatchObject({ ok: false, error: { code: 'E_INVALID_MESSAGE' } })
  })

  it('시간 초과 시 reject 한다', async () => {
    const sock = new FakeSessionSocket()
    const p = runSendSession(sock, request, { timeoutMs: 1000 })
    const assertion = expect(p).rejects.toThrow(/timed out/i)
    vi.advanceTimersByTime(1000)
    await assertion
  })

  it('응답 전에 연결이 끊기면 reject 한다', async () => {
    const sock = new FakeSessionSocket()
    const p = runSendSession(sock, request, { timeoutMs: 1000 })
    const assertion = expect(p).rejects.toThrow(/closed/i)
    sock.close()
    await assertion
  })
})

describe('FR-14 pnpm send — 결과 출력', () => {
  it('성공 응답 → exit 0, applied/removed 요약', () => {
    const r = formatResult({ requestId: 'r', type: 'cookies.replace', ok: true, applied: 2, removed: 1, failed: [], dryRun: false })
    expect(r.exitCode).toBe(EXIT.OK)
    expect(r.lines.join('\n')).toMatch(/applied.*2/)
    expect(r.lines.join('\n')).toMatch(/removed.*1/)
  })
  it('dryRun 이면 표시한다', () => {
    const r = formatResult({ requestId: 'r', type: 'cookies.replace', ok: true, applied: 2, removed: 0, failed: [], dryRun: true })
    expect(r.lines.join('\n')).toMatch(/dry-run/i)
  })
  it('opened 가 있으면 탭 정보를 출력한다', () => {
    const r = formatResult({ requestId: 'r', type: 'cookies.replace', ok: true, applied: 1, removed: 0, failed: [], dryRun: false, opened: { url: 'https://x.com/', tabId: 7, reloaded: true } })
    expect(r.lines.join('\n')).toMatch(/https:\/\/x\.com\/.*tab 7.*reloaded/)
  })
  it('부분 실패 → exit 1, 실패 쿠키 목록(값 미포함)', () => {
    const r = formatResult({
      requestId: 'r', type: 'cookies.replace', ok: false, applied: 1, removed: 0, dryRun: false,
      failed: [{ name: 'old', domain: '.x.com', path: '/', code: 'E_EXPIRED', message: 'expired' }],
    })
    expect(r.exitCode).toBe(EXIT.FAILED)
    expect(r.lines.join('\n')).toMatch(/E_EXPIRED.*old/)
  })
  it('요청 단위 오류 → exit 1, 코드와 메시지', () => {
    const r = formatResult({ requestId: 'r', type: 'cookies.replace', ok: false, error: { code: 'E_UNAUTHORIZED', message: 'token mismatch' } })
    expect(r.exitCode).toBe(EXIT.FAILED)
    expect(r.lines.join('\n')).toMatch(/E_UNAUTHORIZED.*token mismatch/)
  })
  it('알 수 없는 형식 → exit 1', () => {
    expect(formatResult({ weird: true }).exitCode).toBe(EXIT.FAILED)
  })
})
