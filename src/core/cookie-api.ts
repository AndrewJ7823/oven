/**
 * 코어가 의존하는 쿠키 API 인터페이스.
 * chrome.cookies 와 시그니처를 맞춰 어댑터를 얇게 유지하고, 테스트에서는 FakeCookies 로 대체한다. (NFR-02)
 */
export type SameSite = 'no_restriction' | 'lax' | 'strict' | 'unspecified'

export interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  hostOnly: boolean
  sameSite: SameSite
  session: boolean
  expirationDate?: number
}

export interface SetCookieDetails {
  url: string
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: SameSite
  expirationDate?: number
}

export interface CookieApi {
  getAll(filter: { domain?: string; name?: string }): Promise<StoredCookie[]>
  set(details: SetCookieDetails): Promise<StoredCookie | null>
  remove(details: { url: string; name: string }): Promise<unknown>
}
