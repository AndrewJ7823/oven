import type { SetCookieDetails } from './cookie-api'
import type { NormalizedCookie } from './protocol'
import { buildCookieUrl, stripLeadingDot } from './cookie-url'

/** 정규화된 쿠키 → chrome.cookies.set 상세. hostOnly 면 domain 을 생략해 host-only 쿠키가 된다. (FR-06) */
export function toSetDetails(c: NormalizedCookie): SetCookieDetails {
  return {
    url: buildCookieUrl(c),
    name: c.name,
    value: c.value,
    ...(c.hostOnly ? {} : { domain: stripLeadingDot(c.domain) }),
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    ...(c.expirationDate !== undefined ? { expirationDate: c.expirationDate } : {}),
  }
}
