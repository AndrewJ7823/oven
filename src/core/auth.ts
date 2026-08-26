import { stripLeadingDot } from './cookie-url'

/** 상수 시간 문자열 비교 (FR-04). 길이가 다르면 false 지만 비교 루프는 끝까지 돈다. */
export function tokensMatch(expected: string, provided: string | undefined): boolean {
  if (provided === undefined) return false
  const a = new TextEncoder().encode(expected)
  const b = new TextEncoder().encode(provided)
  let diff = a.length ^ b.length
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) diff |= (a[i % a.length] ?? 0) ^ (b[i % b.length] ?? 0)
  return diff === 0 && a.length === b.length
}

const normalize = (d: string) => stripLeadingDot(d.trim().toLowerCase())

/** 허용 목록이 비어 있으면 모두 허용. 그 외에는 동일 도메인 또는 하위 도메인만 허용. (FR-05) */
export function isDomainAllowed(domain: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true
  const d = normalize(domain)
  return allowed.some((a) => {
    const base = normalize(a)
    return d === base || d.endsWith('.' + base)
  })
}

export function findDisallowedDomains(cookies: readonly { domain: string }[], allowed: readonly string[]): string[] {
  const out: string[] = []
  for (const c of cookies) {
    if (!isDomainAllowed(c.domain, allowed) && !out.includes(c.domain)) out.push(c.domain)
  }
  return out
}
