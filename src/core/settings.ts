import type { StorageAreaLike } from './storage-api'
import { stripLeadingDot } from './cookie-url'

export interface Settings {
  token: string
  allowedDomains: string[]
  websocket: { enabled: boolean; url: string }
}

export const SETTINGS_KEY = 'settings'

export const DEFAULT_SETTINGS: Settings = {
  token: '',
  allowedDomains: [],
  websocket: { enabled: false, url: 'ws://127.0.0.1:8765' },
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function normalizeDomainList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const d of raw) {
    if (typeof d !== 'string') continue
    const n = stripLeadingDot(d.trim().toLowerCase())
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}

export function normalizeSettings(raw: unknown): Settings {
  const r = isRecord(raw) ? raw : {}
  const ws = isRecord(r['websocket']) ? r['websocket'] : {}
  return {
    token: typeof r['token'] === 'string' ? r['token'].trim() : DEFAULT_SETTINGS.token,
    allowedDomains: normalizeDomainList(r['allowedDomains']),
    websocket: {
      enabled: typeof ws['enabled'] === 'boolean' ? ws['enabled'] : DEFAULT_SETTINGS.websocket.enabled,
      url: typeof ws['url'] === 'string' && ws['url'].trim() ? ws['url'].trim() : DEFAULT_SETTINGS.websocket.url,
    },
  }
}

export interface SettingsStore {
  load(): Promise<Settings>
  save(patch: Partial<Settings>): Promise<Settings>
}

export function createSettingsStore(area: StorageAreaLike): SettingsStore {
  const load = async (): Promise<Settings> => normalizeSettings((await area.get(SETTINGS_KEY))[SETTINGS_KEY])
  return {
    load,
    async save(patch) {
      const next = normalizeSettings({ ...(await load()), ...patch })
      await area.set({ [SETTINGS_KEY]: next })
      return next
    },
  }
}
