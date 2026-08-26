/**
 * 서비스 워커 엔트리. 유일하게 실제 chrome.* 를 만지는 곳 — 어댑터로 감싸 코어에 주입한다. (NFR-02)
 */
import type { CookieApi } from '../core/cookie-api'
import type { NavigatorApi } from '../core/navigator-api'
import type { StorageAreaLike } from '../core/storage-api'
import { createHandler } from '../core/handler'
import { createSettingsStore } from '../core/settings'
import { createActivityLog, summarize } from '../core/activity-log'
import { attachExternalMessageTransport } from '../transports/external-message'
import { WebSocketTransport } from '../transports/websocket'

// ── 어댑터 ────────────────────────────────────────────────────────────
const cookieApi: CookieApi = {
  getAll: (filter) => chrome.cookies.getAll(filter) as Promise<never>,
  set: (details) => chrome.cookies.set(details) as Promise<never>,
  remove: (details) => chrome.cookies.remove(details),
}

// chrome.windows/tabs → NavigatorApi. 창을 열고, 지정 탭을 캐시 무시하고 새로고침한다. (FR-12)
const navigatorApi: NavigatorApi = {
  async openWindow(url, focused) {
    const win = await chrome.windows.create({ url, focused })
    return { tabId: win?.tabs?.[0]?.id ?? null }
  },
  async reloadTab(tabId) {
    await chrome.tabs.reload(tabId, { bypassCache: true })
  },
}

const storageArea = (area: chrome.storage.StorageArea): StorageAreaLike => ({
  get: (key) => area.get(key),
  set: (items) => area.set(items),
})

const settingsStore = createSettingsStore(storageArea(chrome.storage.local))
const activityLog = createActivityLog(storageArea(chrome.storage.session))

// ── 핸들러 ────────────────────────────────────────────────────────────
const handle = createHandler({
  cookies: cookieApi,
  navigator: navigatorApi,
  settings: () => settingsStore.load(),
  now: () => Math.floor(Date.now() / 1000),
  version: chrome.runtime.getManifest().version,
  onResult: (response, meta) => {
    void activityLog.append(summarize(response, meta, Date.now()))
  },
})

// ── 트랜스포트 1: externally_connectable ──────────────────────────────
attachExternalMessageTransport(chrome.runtime.onMessageExternal, handle)

// ── 트랜스포트 2: 로컬 WebSocket ──────────────────────────────────────
let wsTransport: WebSocketTransport | null = null
let wsUrl: string | null = null

async function syncWebSocket(): Promise<void> {
  const { websocket } = await settingsStore.load()
  const wantUrl = websocket.enabled ? websocket.url : null

  if (wantUrl === wsUrl && (wantUrl === null || wsTransport?.state !== 'idle')) return

  wsTransport?.stop()
  wsTransport = null
  wsUrl = wantUrl
  if (!wantUrl) return

  try {
    wsTransport = new WebSocketTransport({ url: wantUrl, handle, factory: (u) => new WebSocket(u) })
    wsTransport.start()
  } catch (e) {
    console.warn('[oven] websocket transport disabled:', e instanceof Error ? e.message : e)
    wsUrl = null
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'settings' in changes) void syncWebSocket()
})

// 서비스 워커가 종료된 뒤에도 WebSocket 연결을 되살리기 위한 알람
const KEEPALIVE_ALARM = 'oven-ws-keepalive'
chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 })
})
chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 })
})
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) void syncWebSocket()
})

void syncWebSocket()
