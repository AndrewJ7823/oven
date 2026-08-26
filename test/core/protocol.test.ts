import { describe, it, expect } from 'vitest'
import { validateInbound, MAX_COOKIES } from '../../src/core/protocol'

const baseCookie = { name: 'sid', value: 'v', domain: '.example.com' }
const replace = (over: Record<string, unknown> = {}, cookie: Record<string, unknown> = {}) => ({
  type: 'cookies.replace',
  requestId: 'r1',
  cookies: [{ ...baseCookie, ...cookie }],
  ...over,
})

describe('FR-03 요청 메시지 검증', () => {
  it('유효한 cookies.replace 요청을 정규화하여 반환한다', () => {
    const r = validateInbound(replace())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.request.type).toBe('cookies.replace')
    if (r.request.type !== 'cookies.replace') return
    expect(r.request.mode).toBe('merge')
    expect(r.request.options.dryRun).toBe(false)
    expect(r.request.cookies[0]).toEqual({
      name: 'sid',
      value: 'v',
      domain: '.example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      hostOnly: false,
      sameSite: 'unspecified',
    })
  })

  it('ping 요청을 허용한다 (requestId 없으면 null)', () => {
    const r = validateInbound({ type: 'ping' })
    expect(r).toEqual({ ok: true, request: { type: 'ping', requestId: null, token: undefined } })
  })

  it.each([null, 42, 'str', [], undefined])('객체가 아닌 입력(%p)은 E_INVALID_MESSAGE', (raw) => {
    const r = validateInbound(raw)
    expect(r).toMatchObject({ ok: false, code: 'E_INVALID_MESSAGE' })
  })

  it('지원하지 않는 type 은 E_UNKNOWN_TYPE', () => {
    expect(validateInbound({ type: 'cookies.list' })).toMatchObject({ ok: false, code: 'E_UNKNOWN_TYPE' })
  })

  it('requestId 가 문자열이 아니거나 128자를 넘으면 거부', () => {
    expect(validateInbound(replace({ requestId: 12 }))).toMatchObject({ ok: false, code: 'E_INVALID_MESSAGE' })
    expect(validateInbound(replace({ requestId: 'x'.repeat(129) }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({ requestId: 'x'.repeat(128) }))).toMatchObject({ ok: true })
  })

  it('cookies 가 비어있거나 배열이 아니면 거부', () => {
    expect(validateInbound(replace({ cookies: [] }))).toMatchObject({ ok: false, code: 'E_INVALID_MESSAGE' })
    expect(validateInbound(replace({ cookies: {} }))).toMatchObject({ ok: false, code: 'E_INVALID_MESSAGE' })
  })

  it(`쿠키가 ${MAX_COOKIES}개를 넘으면 E_TOO_MANY_COOKIES`, () => {
    const cookies = Array.from({ length: MAX_COOKIES + 1 }, (_, i) => ({ ...baseCookie, name: `c${i}` }))
    expect(validateInbound(replace({ cookies }))).toMatchObject({ ok: false, code: 'E_TOO_MANY_COOKIES' })
    expect(validateInbound(replace({ cookies: cookies.slice(0, MAX_COOKIES) }))).toMatchObject({ ok: true })
  })

  it.each(['', 'a b', 'a;b', 'a=b', 'a\nb', 42])('잘못된 쿠키 name(%p) 거부', (name) => {
    expect(validateInbound(replace({}, { name }))).toMatchObject({ ok: false, code: 'E_INVALID_MESSAGE' })
  })

  it('value 는 문자열이어야 한다 (빈 문자열 허용)', () => {
    expect(validateInbound(replace({}, { value: 1 }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({}, { value: '' }))).toMatchObject({ ok: true })
  })

  it.each(['', 'exa mple.com', 'http://example.com', 'example..com', '-bad.com'])('잘못된 domain(%p) 거부', (domain) => {
    expect(validateInbound(replace({}, { domain }))).toMatchObject({ ok: false, code: 'E_INVALID_MESSAGE' })
  })

  it('domain 은 소문자로 정규화되고 localhost / IP 를 허용한다', () => {
    const r = validateInbound(replace({}, { domain: 'API.Example.COM' }))
    expect(r.ok && r.request.type === 'cookies.replace' && r.request.cookies[0]?.domain).toBe('api.example.com')
    expect(validateInbound(replace({}, { domain: 'localhost' }))).toMatchObject({ ok: true })
    expect(validateInbound(replace({}, { domain: '127.0.0.1' }))).toMatchObject({ ok: true })
  })

  it('path 는 / 로 시작해야 한다', () => {
    expect(validateInbound(replace({}, { path: 'abc' }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({}, { path: '/abc' }))).toMatchObject({ ok: true })
  })

  it('sameSite 는 허용된 enum 값만 가능', () => {
    expect(validateInbound(replace({}, { sameSite: 'Lax' }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({}, { sameSite: 'strict' }))).toMatchObject({ ok: true })
  })

  it('sameSite=no_restriction 은 secure=true 를 요구한다', () => {
    expect(validateInbound(replace({}, { sameSite: 'no_restriction' }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({}, { sameSite: 'no_restriction', secure: true }))).toMatchObject({ ok: true })
  })

  it('expirationDate 는 숫자만 허용', () => {
    expect(validateInbound(replace({}, { expirationDate: '123' }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({}, { expirationDate: NaN }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({}, { expirationDate: 1790000000 }))).toMatchObject({ ok: true })
  })

  it('boolean 필드에 문자열이 오면 거부', () => {
    expect(validateInbound(replace({}, { secure: 'true' }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({}, { httpOnly: 1 }))).toMatchObject({ ok: false })
  })

  it('__Secure- 접두어는 secure=true 를 요구한다', () => {
    expect(validateInbound(replace({}, { name: '__Secure-a' }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({}, { name: '__Secure-a', secure: true }))).toMatchObject({ ok: true })
  })

  it('AC-08 __Host- 접두어는 secure, path=/, hostOnly 를 요구한다', () => {
    const okCookie = { name: '__Host-a', secure: true, path: '/', hostOnly: true, domain: 'example.com' }
    expect(validateInbound(replace({}, okCookie))).toMatchObject({ ok: true })
    expect(validateInbound(replace({}, { ...okCookie, hostOnly: false }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({}, { ...okCookie, path: '/x' }))).toMatchObject({ ok: false })
    expect(validateInbound(replace({}, { ...okCookie, secure: false }))).toMatchObject({ ok: false })
  })

  it('hostOnly=true 인 쿠키의 domain 은 . 으로 시작할 수 없다', () => {
    expect(validateInbound(replace({}, { hostOnly: true, domain: '.example.com' }))).toMatchObject({ ok: false })
  })

  it('mode 는 merge/replace 만 허용', () => {
    expect(validateInbound(replace({ mode: 'replace' }))).toMatchObject({ ok: true, request: { mode: 'replace' } })
    expect(validateInbound(replace({ mode: 'nuke' }))).toMatchObject({ ok: false })
  })

  it('options.dryRun 은 boolean 이어야 한다', () => {
    expect(validateInbound(replace({ options: { dryRun: true } }))).toMatchObject({
      ok: true,
      request: { options: { dryRun: true } },
    })
    expect(validateInbound(replace({ options: { dryRun: 'yes' } }))).toMatchObject({ ok: false })
  })

  it('token 이 있으면 문자열이어야 하고 그대로 전달된다', () => {
    expect(validateInbound(replace({ token: 't' }))).toMatchObject({ ok: true, request: { token: 't' } })
    expect(validateInbound(replace({ token: 5 }))).toMatchObject({ ok: false })
  })

  it('오류 메시지는 어떤 쿠키/필드가 문제인지 알려준다', () => {
    const r = validateInbound(replace({}, { path: 'x' }))
    expect(!r.ok && r.message).toMatch(/cookies\[0\]\.path/)
  })
})
