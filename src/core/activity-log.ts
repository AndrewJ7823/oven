import type { OutboundResponse } from './protocol'
import type { StorageAreaLike } from './storage-api'

export const MAX_LOG_ENTRIES = 50
export const LOG_KEY = 'activityLog'

export interface RequestMeta {
  transport: 'external' | 'websocket' | string
  origin?: string
}

/** 쿠키 값·이름을 담지 않는 요약 로그 항목 (FR-11, NFR-04) */
export interface ActivityEntry {
  at: number
  transport: string
  type: string | null
  ok: boolean
  applied?: number
  removed?: number
  failedCount?: number
  errorCode?: string
}

export function summarize(res: OutboundResponse, meta: RequestMeta, at: number): ActivityEntry {
  const base = { at, transport: meta.transport, type: res.type, ok: res.ok }
  if ('error' in res) return { ...base, errorCode: res.error.code }
  if (res.type === 'cookies.replace') return { ...base, applied: res.applied, removed: res.removed, failedCount: res.failed.length }
  return base
}

export interface ActivityLog {
  append(entry: ActivityEntry): Promise<void>
  list(): Promise<ActivityEntry[]>
}

export function createActivityLog(area: StorageAreaLike): ActivityLog {
  const list = async (): Promise<ActivityEntry[]> => {
    const v = (await area.get(LOG_KEY))[LOG_KEY]
    return Array.isArray(v) ? (v as ActivityEntry[]) : []
  }
  return {
    list,
    async append(entry) {
      const next = [entry, ...(await list())].slice(0, MAX_LOG_ENTRIES)
      await area.set({ [LOG_KEY]: next })
    },
  }
}
