import { describe, it, expect } from 'vitest'
import { tokensMatch, isDomainAllowed, findDisallowedDomains } from '../../src/core/auth'

describe('FR-04 토큰 비교', () => {
  it('동일하면 true', () => expect(tokensMatch('abc', 'abc')).toBe(true))
  it('다르면 false (길이 동일/상이 모두)', () => {
    expect(tokensMatch('abc', 'abd')).toBe(false)
    expect(tokensMatch('abc', 'abcd')).toBe(false)
    expect(tokensMatch('abc', '')).toBe(false)
  })
  it('provided 가 undefined 면 false', () => expect(tokensMatch('abc', undefined)).toBe(false))
})

describe('FR-05 도메인 허용 목록', () => {
  it('허용 목록이 비어 있으면 모두 허용', () => {
    expect(isDomainAllowed('.anything.com', [])).toBe(true)
  })
  it('정확히 일치 또는 하위 도메인이면 허용', () => {
    expect(isDomainAllowed('example.com', ['example.com'])).toBe(true)
    expect(isDomainAllowed('.example.com', ['example.com'])).toBe(true)
    expect(isDomainAllowed('api.example.com', ['.example.com'])).toBe(true)
    expect(isDomainAllowed('API.EXAMPLE.com', ['example.com'])).toBe(true)
  })
  it('접미어만 같은 다른 도메인은 거부', () => {
    expect(isDomainAllowed('notexample.com', ['example.com'])).toBe(false)
    expect(isDomainAllowed('example.com.evil.io', ['example.com'])).toBe(false)
  })
  it('findDisallowedDomains 는 중복 제거된 위반 도메인 목록을 반환', () => {
    const cookies = [{ domain: 'a.com' }, { domain: '.b.com' }, { domain: 'a.com' }, { domain: 'x.ok.com' }]
    expect(findDisallowedDomains(cookies, ['ok.com'])).toEqual(['a.com', '.b.com'])
    expect(findDisallowedDomains(cookies, [])).toEqual([])
  })
})
