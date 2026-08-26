import type { CookieApi, StoredCookie } from './cookie-api'
import type { CookieFailure, ReplaceRequest, ReplaceResponse } from './protocol'
import { buildCookieUrl, stripLeadingDot } from './cookie-url'
import { toSetDetails } from './cookie-mapper'

export interface ReplacerDeps {
  /** 현재 시각(초, UNIX). 결정적 테스트를 위해 주입 (docs/TDD.md) */
  now: () => number
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** replace 모드: 요청 도메인과 정확히 일치하는 기존 쿠키 목록 (하위 도메인 제외). (FR-07) */
async function collectExactDomainCookies(api: CookieApi, domains: Iterable<string>): Promise<StoredCookie[]> {
  const out: StoredCookie[] = []
  for (const domain of domains) {
    const candidates = await api.getAll({ domain })
    out.push(...candidates.filter((c) => stripLeadingDot(c.domain) === domain))
  }
  return out
}

export async function replaceCookies(api: CookieApi, req: ReplaceRequest, deps: ReplacerDeps): Promise<ReplaceResponse> {
  const { dryRun } = req.options
  const now = deps.now()
  const failed: CookieFailure[] = []
  let applied = 0
  let removed = 0

  if (req.mode === 'replace') {
    const domains = new Set(req.cookies.map((c) => stripLeadingDot(c.domain)))
    const existing = await collectExactDomainCookies(api, domains)
    for (const c of existing) {
      if (!dryRun) await api.remove({ url: buildCookieUrl(c), name: c.name })
      removed++
    }
  }

  for (const c of req.cookies) {
    if (c.expirationDate !== undefined && c.expirationDate <= now) {
      failed.push({ name: c.name, domain: c.domain, path: c.path, code: 'E_EXPIRED', message: `expirationDate ${c.expirationDate} <= now ${now}` })
      continue
    }
    if (dryRun) {
      applied++
      continue
    }
    try {
      const result = await api.set(toSetDetails(c))
      if (result === null) {
        failed.push({ name: c.name, domain: c.domain, path: c.path, code: 'E_SET_FAILED', message: 'chrome.cookies.set returned null' })
      } else {
        applied++
      }
    } catch (e) {
      failed.push({ name: c.name, domain: c.domain, path: c.path, code: 'E_SET_FAILED', message: errorMessage(e) })
    }
  }

  return { requestId: req.requestId, type: 'cookies.replace', ok: failed.length === 0, applied, removed, failed, dryRun }
}
