import type { SameSite } from './cookie-api'

// ── 상수 ──────────────────────────────────────────────────────────────
export const SUPPORTED_TYPES = ['ping', 'cookies.replace'] as const
export const MAX_COOKIES = 500
export const MAX_REQUEST_ID_LENGTH = 128
const SAME_SITE_VALUES: readonly SameSite[] = ['no_restriction', 'lax', 'strict', 'unspecified']
const MODES = ['merge', 'replace'] as const

export type InboundType = (typeof SUPPORTED_TYPES)[number]
export type ReplaceMode = (typeof MODES)[number]

export type RequestErrorCode =
  | 'E_INVALID_MESSAGE'
  | 'E_UNKNOWN_TYPE'
  | 'E_UNAUTHORIZED'
  | 'E_DOMAIN_NOT_ALLOWED'
  | 'E_TOO_MANY_COOKIES'
  | 'E_INTERNAL'
export type CookieErrorCode = 'E_EXPIRED' | 'E_SET_FAILED'

// ── 요청 ──────────────────────────────────────────────────────────────
export interface NormalizedCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  hostOnly: boolean
  sameSite: SameSite
  expirationDate?: number
}

export interface PingRequest {
  type: 'ping'
  requestId: string | null
  token?: string
}

export interface ReplaceRequest {
  type: 'cookies.replace'
  requestId: string | null
  token?: string
  mode: ReplaceMode
  options: { dryRun: boolean }
  cookies: NormalizedCookie[]
}

export type InboundRequest = PingRequest | ReplaceRequest

// ── 응답 ──────────────────────────────────────────────────────────────
export interface CookieFailure {
  name: string
  domain: string
  path: string
  code: CookieErrorCode
  message: string
}

export interface ReplaceResponse {
  requestId: string | null
  type: 'cookies.replace'
  ok: boolean
  applied: number
  removed: number
  failed: CookieFailure[]
  dryRun: boolean
}

export interface PongResponse {
  requestId: string | null
  type: 'pong'
  ok: true
  version: string
}

export interface ErrorResponse {
  requestId: string | null
  type: string | null
  ok: false
  error: { code: RequestErrorCode; message: string }
}

export type OutboundResponse = ReplaceResponse | PongResponse | ErrorResponse

export function errorResponse(
  code: RequestErrorCode,
  message: string,
  ctx: { requestId?: string | null; type?: string | null } = {},
): ErrorResponse {
  return { requestId: ctx.requestId ?? null, type: ctx.type ?? null, ok: false, error: { code, message } }
}

// ── 검증 ──────────────────────────────────────────────────────────────
export type ValidationResult =
  | { ok: true; request: InboundRequest }
  | { ok: false; code: 'E_INVALID_MESSAGE' | 'E_UNKNOWN_TYPE' | 'E_TOO_MANY_COOKIES'; message: string; requestId: string | null; type: string | null }

class Invalid extends Error {}
const fail = (msg: string): never => {
  throw new Invalid(msg)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// RFC 6265 token: 공백/제어문자/구분자(; =) 제외
const COOKIE_NAME_RE = /^[^\s;=\x00-\x1f\x7f]+$/
// 라벨은 영숫자/하이픈(양끝은 영숫자). 선행 . 허용. localhost, IPv4 도 매칭됨
const DOMAIN_RE = /^\.?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/

function readBoolean(obj: Record<string, unknown>, key: string, path: string, fallback: boolean): boolean {
  const v = obj[key]
  if (v === undefined) return fallback
  if (typeof v !== 'boolean') fail(`${path}.${key} must be a boolean`)
  return v as boolean
}

function readRequestId(raw: Record<string, unknown>): string | null {
  const id = raw['requestId']
  if (id === undefined || id === null) return null
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_REQUEST_ID_LENGTH) {
    fail(`requestId must be a string of 1..${MAX_REQUEST_ID_LENGTH} chars`)
  }
  return id as string
}

function readToken(raw: Record<string, unknown>): string | undefined {
  const t = raw['token']
  if (t === undefined) return undefined
  if (typeof t !== 'string') fail('token must be a string')
  return t as string
}

function normalizeCookie(raw: unknown, path: string): NormalizedCookie {
  if (!isRecord(raw)) return fail(`${path} must be an object`)

  const name = raw['name']
  if (typeof name !== 'string' || !COOKIE_NAME_RE.test(name)) fail(`${path}.name is not a valid cookie name`)

  const value = raw['value']
  if (typeof value !== 'string') fail(`${path}.value must be a string`)

  const domainRaw = raw['domain']
  if (typeof domainRaw !== 'string') fail(`${path}.domain must be a string`)
  const domain = (domainRaw as string).trim().toLowerCase()
  if (!DOMAIN_RE.test(domain)) fail(`${path}.domain is not a valid host`)

  const pathRaw = raw['path']
  const cookiePath = pathRaw === undefined ? '/' : pathRaw
  if (typeof cookiePath !== 'string' || !cookiePath.startsWith('/')) fail(`${path}.path must start with "/"`)

  const secure = readBoolean(raw, 'secure', path, false)
  const httpOnly = readBoolean(raw, 'httpOnly', path, false)
  const hostOnly = readBoolean(raw, 'hostOnly', path, false)

  const sameSiteRaw = raw['sameSite'] ?? 'unspecified'
  if (!SAME_SITE_VALUES.includes(sameSiteRaw as SameSite)) fail(`${path}.sameSite must be one of ${SAME_SITE_VALUES.join('|')}`)
  const sameSite = sameSiteRaw as SameSite

  const exp = raw['expirationDate']
  if (exp !== undefined && (typeof exp !== 'number' || !Number.isFinite(exp))) fail(`${path}.expirationDate must be a finite number`)

  // 의미 규칙
  if (sameSite === 'no_restriction' && !secure) fail(`${path}: sameSite=no_restriction requires secure=true`)
  if (hostOnly && domain.startsWith('.')) fail(`${path}: hostOnly cookie domain must not start with "."`)
  if ((name as string).startsWith('__Secure-') && !secure) fail(`${path}: __Secure- prefix requires secure=true`)
  if ((name as string).startsWith('__Host-')) {
    if (!secure) fail(`${path}: __Host- prefix requires secure=true`)
    if (cookiePath !== '/') fail(`${path}: __Host- prefix requires path="/"`)
    if (!hostOnly) fail(`${path}: __Host- prefix requires hostOnly=true`)
  }

  return {
    name: name as string,
    value: value as string,
    domain,
    path: cookiePath as string,
    secure,
    httpOnly,
    hostOnly,
    sameSite,
    ...(exp !== undefined ? { expirationDate: exp as number } : {}),
  }
}

export function validateInbound(raw: unknown): ValidationResult {
  if (!isRecord(raw)) {
    return { ok: false, code: 'E_INVALID_MESSAGE', message: 'message must be a JSON object', requestId: null, type: null }
  }
  const typeRaw = raw['type']
  const type = typeof typeRaw === 'string' ? typeRaw : null
  let requestId: string | null = null

  try {
    requestId = readRequestId(raw)
    const token = readToken(raw)

    if (type === null || !(SUPPORTED_TYPES as readonly string[]).includes(type)) {
      return { ok: false, code: 'E_UNKNOWN_TYPE', message: `unsupported type: ${String(typeRaw)}`, requestId, type }
    }

    if (type === 'ping') return { ok: true, request: { type: 'ping', requestId, token } }

    const cookiesRaw = raw['cookies']
    if (!Array.isArray(cookiesRaw) || cookiesRaw.length === 0) fail('cookies must be a non-empty array')
    const cookiesArr = cookiesRaw as unknown[]
    if (cookiesArr.length > MAX_COOKIES) {
      return { ok: false, code: 'E_TOO_MANY_COOKIES', message: `cookies exceeds ${MAX_COOKIES}`, requestId, type }
    }

    const modeRaw = raw['mode'] ?? 'merge'
    if (!(MODES as readonly unknown[]).includes(modeRaw)) fail(`mode must be one of ${MODES.join('|')}`)

    const optionsRaw: unknown = raw['options'] ?? {}
    if (!isRecord(optionsRaw)) return fail('options must be an object')
    const dryRun = readBoolean(optionsRaw, 'dryRun', 'options', false)

    const cookies = cookiesArr.map((c, i) => normalizeCookie(c, `cookies[${i}]`))

    return {
      ok: true,
      request: { type: 'cookies.replace', requestId, token, mode: modeRaw as ReplaceMode, options: { dryRun }, cookies },
    }
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, code: 'E_INVALID_MESSAGE', message: e.message, requestId, type }
    throw e
  }
}
