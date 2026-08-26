import type { StorageAreaLike } from '../core/storage-api'
import { createSettingsStore } from '../core/settings'
import { createActivityLog } from '../core/activity-log'
import { describeStatus, summarizeLast, type ConnectionStatus } from '../core/status'

const area = (a: chrome.storage.StorageArea): StorageAreaLike => ({ get: (k) => a.get(k), set: (i) => a.set(i) })
const settingsStore = createSettingsStore(area(chrome.storage.local))
const activityLog = createActivityLog(area(chrome.storage.session))
const STATUS_KEY = 'connectionStatus'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const enabledEl = $<HTMLInputElement>('ws-enabled')

function renderStatus(status: ConnectionStatus): void {
  const view = describeStatus(status)
  $('status-label').textContent = view.label
  $<HTMLSpanElement>('status').querySelector<HTMLElement>('.dot')!.dataset['dot'] = view.dot
}

async function loadStatus(): Promise<void> {
  const raw = (await chrome.storage.session.get(STATUS_KEY))[STATUS_KEY]
  renderStatus((typeof raw === 'string' ? raw : 'disabled') as ConnectionStatus)
}

async function load(): Promise<void> {
  const s = await settingsStore.load()
  enabledEl.checked = s.websocket.enabled
  $('ws-url').textContent = s.websocket.url
  $('last').textContent = summarizeLast((await activityLog.list())[0])
  await loadStatus()
}

// 토글 변경 → 설정 저장(서비스 워커가 storage.onChanged 로 재접속)
enabledEl.addEventListener('change', async () => {
  await settingsStore.save({ websocket: { ...(await settingsStore.load()).websocket, enabled: enabledEl.checked } })
})

$('reconnect').addEventListener('click', () => {
  chrome.runtime.sendMessage({ cmd: 'reconnect' }, () => void loadStatus())
})

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage())

// 서비스 워커가 상태/로그를 갱신하면 팝업도 실시간 반영
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'session' && STATUS_KEY in changes) renderStatus(changes[STATUS_KEY]?.newValue ?? 'disabled')
  if (areaName === 'session' && 'activityLog' in changes) void load()
})

void load()
