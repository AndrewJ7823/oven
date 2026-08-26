import { describe, it, expect } from 'vitest'
import { buildCookieUrl, stripLeadingDot } from '../../src/core/cookie-url'

describe('FR-06 쿠키 URL 구성', () => {
  it('secure 쿠키는 https, 아니면 http', () => {
    expect(buildCookieUrl({ domain: 'example.com', path: '/', secure: true })).toBe('https://example.com/')
    expect(buildCookieUrl({ domain: 'example.com', path: '/', secure: false })).toBe('http://example.com/')
  })
  it('선행 . 을 제거하고 path 를 붙인다', () => {
    expect(buildCookieUrl({ domain: '.example.com', path: '/api', secure: true })).toBe('https://example.com/api')
  })
  it('stripLeadingDot', () => {
    expect(stripLeadingDot('.a.com')).toBe('a.com')
    expect(stripLeadingDot('a.com')).toBe('a.com')
  })
})
