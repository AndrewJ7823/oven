import type { CookieApi, SetCookieDetails, StoredCookie } from '../../src/core/cookie-api'

const stripDot = (d: string) => (d.startsWith('.') ? d.slice(1) : d)

/**
 * chrome.cookies 의 핵심 의미론(upsert 키 = name+domain+path, domain 필터 = 도메인/하위도메인)을 흉내내는 인메모리 페이크.
 */
export class FakeCookies implements CookieApi {
  private store: StoredCookie[] = []
  private failNames = new Set<string>()
  public setCalls: SetCookieDetails[] = []
  public removeCalls: { url: string; name: string }[] = []

  seed(partial: Partial<StoredCookie> & Pick<StoredCookie, 'name' | 'domain'>): StoredCookie {
    const cookie: StoredCookie = {
      value: '',
      path: '/',
      secure: false,
      httpOnly: false,
      hostOnly: !partial.domain.startsWith('.'),
      sameSite: 'unspecified',
      session: partial.expirationDate === undefined,
      ...partial,
    }
    this.upsert(cookie)
    return cookie
  }

  /** 지정한 이름의 쿠키 set 을 실패(null 반환)시킨다. FR-08 테스트용 */
  failOn(name: string): void {
    this.failNames.add(name)
  }

  all(): StoredCookie[] {
    return this.store.map((c) => ({ ...c }))
  }

  async getAll(filter: { domain?: string; name?: string }): Promise<StoredCookie[]> {
    return this.store
      .filter((c) => {
        if (filter.name !== undefined && c.name !== filter.name) return false
        if (filter.domain !== undefined) {
          const want = stripDot(filter.domain).toLowerCase()
          const have = stripDot(c.domain).toLowerCase()
          if (have !== want && !have.endsWith('.' + want)) return false
        }
        return true
      })
      .map((c) => ({ ...c }))
  }

  async set(details: SetCookieDetails): Promise<StoredCookie | null> {
    this.setCalls.push(details)
    if (this.failNames.has(details.name)) return null
    const url = new URL(details.url)
    const domain = details.domain ? '.' + stripDot(details.domain) : url.hostname
    const cookie: StoredCookie = {
      name: details.name,
      value: details.value,
      domain,
      path: details.path ?? '/',
      secure: details.secure ?? false,
      httpOnly: details.httpOnly ?? false,
      hostOnly: !details.domain,
      sameSite: details.sameSite ?? 'unspecified',
      session: details.expirationDate === undefined,
      ...(details.expirationDate !== undefined ? { expirationDate: details.expirationDate } : {}),
    }
    this.upsert(cookie)
    return { ...cookie }
  }

  async remove(details: { url: string; name: string }): Promise<unknown> {
    this.removeCalls.push(details)
    const url = new URL(details.url)
    const before = this.store.length
    this.store = this.store.filter(
      (c) => !(c.name === details.name && stripDot(c.domain) === url.hostname && c.path === url.pathname),
    )
    return before === this.store.length ? null : details
  }

  private upsert(cookie: StoredCookie): void {
    const idx = this.store.findIndex(
      (c) => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path,
    )
    if (idx >= 0) this.store[idx] = cookie
    else this.store.push(cookie)
  }
}
