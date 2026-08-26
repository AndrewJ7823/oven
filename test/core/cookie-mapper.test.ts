import { describe, it, expect } from 'vitest'
import { toSetDetails } from '../../src/core/cookie-mapper'
import type { NormalizedCookie } from '../../src/core/protocol'

const cookie: NormalizedCookie = {
  name: 'sid',
  value: 'v',
  domain: '.example.com',
  path: '/p',
  secure: true,
  httpOnly: true,
  hostOnly: false,
  sameSite: 'lax',
  expirationDate: 1790000000,
}

describe('FR-06 chrome.cookies.set 상세 매핑', () => {
  it('도메인 쿠키는 domain 을 포함한다', () => {
    expect(toSetDetails(cookie)).toEqual({
      url: 'https://example.com/p',
      name: 'sid',
      value: 'v',
      domain: 'example.com',
      path: '/p',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: 1790000000,
    })
  })
  it('hostOnly 쿠키는 domain 을 생략한다', () => {
    const d = toSetDetails({ ...cookie, hostOnly: true, domain: 'example.com' })
    expect(d).not.toHaveProperty('domain')
    expect(d.url).toBe('https://example.com/p')
  })
  it('세션 쿠키는 expirationDate 를 생략한다', () => {
    const { expirationDate: _omit, ...session } = cookie
    expect(toSetDetails(session)).not.toHaveProperty('expirationDate')
  })
})
