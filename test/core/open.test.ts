import { describe, it, expect } from 'vitest'
import { validateInbound } from '../../src/core/protocol'

const replace = (open: unknown) => ({
  type: 'cookies.replace',
  requestId: 'r1',
  open,
  cookies: [{ name: 'sid', value: 'v', domain: '.example.com' }],
})

describe('FR-12 open(이동할 주소) 검증', () => {
  it('open 이 없으면 request.open 은 undefined', () => {
    const r = validateInbound({ type: 'cookies.replace', cookies: [{ name: 'a', value: '1', domain: 'x.com' }] })
    expect(r.ok && r.request.type === 'cookies.replace' && r.request.open).toBeUndefined()
  })

  it('유효한 http/https URL 을 정규화한다 (focused 기본 true)', () => {
    const r = validateInbound(replace({ url: 'https://example.com/dashboard' }))
    expect(r.ok).toBe(true)
    if (!r.ok || r.request.type !== 'cookies.replace') return
    expect(r.request.open).toEqual({ url: 'https://example.com/dashboard', focused: true })
  })

  it('focused 를 지정할 수 있다', () => {
    const r = validateInbound(replace({ url: 'http://localhost:3000/', focused: false }))
    expect(r.ok && r.request.type === 'cookies.replace' && r.request.open).toEqual({ url: 'http://localhost:3000/', focused: false })
  })

  it.each([{ url: 123 }, {}, { url: 'not a url' }, { url: 'ws://x.com' }, { url: 'chrome://settings' }, { url: 'file:///etc' }, { url: 'javascript:alert(1)' }])(
    '잘못된 open(%p) 은 E_INVALID_MESSAGE',
    (open) => {
      expect(validateInbound(replace(open))).toMatchObject({ ok: false, code: 'E_INVALID_MESSAGE' })
    },
  )

  it('open 이 객체가 아니면 거부', () => {
    expect(validateInbound(replace('https://x.com'))).toMatchObject({ ok: false, code: 'E_INVALID_MESSAGE' })
  })

  it('focused 가 boolean 이 아니면 거부', () => {
    expect(validateInbound(replace({ url: 'https://x.com', focused: 'yes' }))).toMatchObject({ ok: false })
  })

  it('open: null 은 없는 것으로 취급', () => {
    const r = validateInbound(replace(null))
    expect(r.ok && r.request.type === 'cookies.replace' && r.request.open).toBeUndefined()
  })
})
