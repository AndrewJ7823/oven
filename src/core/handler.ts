import type { CookieApi } from './cookie-api'
import type { NavigatorApi } from './navigator-api'
import type { Settings } from './settings'
import type { OutboundResponse, ReplaceRequest, ReplaceResponse } from './protocol'
import type { RequestMeta } from './activity-log'
import { errorResponse, validateInbound } from './protocol'
import { findDisallowedDomains, tokensMatch } from './auth'
import { replaceCookies } from './replacer'

export type Handler = (raw: unknown, meta: RequestMeta) => Promise<OutboundResponse>

export interface HandlerDeps {
  cookies: CookieApi
  navigator: NavigatorApi
  settings: () => Promise<Settings>
  /** 현재 시각(초) */
  now: () => number
  version: string
  onResult?: (response: OutboundResponse, meta: RequestMeta) => void
}

/**
 * 트랜스포트 무관 진입점: 검증 → 인증 → 도메인 허용 → 실행. (SPEC 6장)
 */
export function createHandler(deps: HandlerDeps): Handler {
  return async (raw, meta) => {
    const response = await process(raw, deps)
    deps.onResult?.(response, meta)
    return response
  }
}

async function process(raw: unknown, deps: HandlerDeps): Promise<OutboundResponse> {
  const v = validateInbound(raw)
  if (!v.ok) return errorResponse(v.code, v.message, { requestId: v.requestId, type: v.type })

  const req = v.request
  if (req.type === 'ping') return { requestId: req.requestId, type: 'pong', ok: true, version: deps.version }

  const settings = await deps.settings()
  const ctx = { requestId: req.requestId, type: req.type }

  if (settings.token !== '' && !tokensMatch(settings.token, req.token)) {
    return errorResponse('E_UNAUTHORIZED', 'token mismatch', ctx)
  }

  const disallowed = findDisallowedDomains(req.cookies, settings.allowedDomains)
  if (disallowed.length > 0) {
    return errorResponse('E_DOMAIN_NOT_ALLOWED', `domains not allowed: ${disallowed.join(', ')}`, ctx)
  }

  return runReplace(req, deps)
}

/**
 * FR-12: open 이 있으면 "창 열기 → 쿠키 주입 → 새로고침" 순서로 처리한다.
 * 새 창은 아직 이전(또는 없는) 쿠키로 로드되므로, 쿠키 주입 후 그 탭을 새로고침해 반영한다.
 */
async function runReplace(req: ReplaceRequest, deps: HandlerDeps): Promise<ReplaceResponse> {
  const open = req.open
  const dryRun = req.options.dryRun

  // 1) 창 열기
  let openedTabId: number | null = null
  if (open && !dryRun) {
    try {
      openedTabId = (await deps.navigator.openWindow(open.url, open.focused)).tabId
    } catch {
      openedTabId = null
    }
  }

  // 2) 쿠키 주입
  const result = await replaceCookies(deps.cookies, req, { now: deps.now })

  // 3) 새로고침
  let reloaded = false
  if (open && !dryRun && openedTabId !== null) {
    try {
      await deps.navigator.reloadTab(openedTabId)
      reloaded = true
    } catch {
      reloaded = false
    }
  }

  if (open) result.opened = { url: open.url, tabId: openedTabId, reloaded }
  return result
}
