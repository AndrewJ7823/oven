export const stripLeadingDot = (domain: string): string => (domain.startsWith('.') ? domain.slice(1) : domain)

/** chrome.cookies.set/remove 에 필요한 url 을 쿠키 속성으로부터 구성한다. (FR-06) */
export function buildCookieUrl(c: { domain: string; path: string; secure: boolean }): string {
  return `${c.secure ? 'https' : 'http'}://${stripLeadingDot(c.domain)}${c.path}`
}
