import type { StorageAreaLike } from '../core/storage-api'
import { createSettingsStore, normalizeDomainList } from '../core/settings'
import { createActivityLog, type ActivityEntry } from '../core/activity-log'
import { isAllowedWebSocketUrl } from '../transports/websocket'

const area = (a: chrome.storage.StorageArea): StorageAreaLike => ({ get: (k) => a.get(k), set: (i) => a.set(i) })
const settingsStore = createSettingsStore(area(chrome.storage.local))
const activityLog = createActivityLog(area(chrome.storage.session))

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const tokenEl = $<HTMLInputElement>('token')
const domainsEl = $<HTMLTextAreaElement>('allowed-domains')
const wsEnabledEl = $<HTMLInputElement>('ws-enabled')
const wsUrlEl = $<HTMLInputElement>('ws-url')
const statusEl = $<HTMLSpanElement>('status')
const tokenWarning = $<HTMLParagraphElement>('token-warning')

function setStatus(msg: string, isError = false): void {
  statusEl.textContent = msg
  statusEl.className = isError ? 'warn' : 'muted'
}

async function load(): Promise<void> {
  $('ext-id').textContent = chrome.runtime.id
  const s = await settingsStore.load()
  tokenEl.value = s.token
  domainsEl.value = s.allowedDomains.join('\n')
  wsEnabledEl.checked = s.websocket.enabled
  wsUrlEl.value = s.websocket.url
  tokenWarning.hidden = s.token !== ''
}

function describe(e: ActivityEntry): string {
  if (e.errorCode) return e.errorCode
  if (e.type === 'cookies.replace') return `applied ${e.applied} · removed ${e.removed} · failed ${e.failedCount}`
  return ''
}

async function renderLog(): Promise<void> {
  const tbody = document.querySelector<HTMLTableSectionElement>('#log tbody')!
  tbody.replaceChildren()
  for (const e of await activityLog.list()) {
    const tr = document.createElement('tr')
    const cells = [new Date(e.at).toLocaleTimeString(), e.transport, e.type ?? '-', e.ok ? 'OK' : 'FAIL', describe(e)]
    cells.forEach((text, i) => {
      const td = document.createElement('td')
      td.textContent = text
      if (i === 3) td.className = e.ok ? 'ok' : 'fail'
      tr.append(td)
    })
    tbody.append(tr)
  }
}

$('settings-form').addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const url = wsUrlEl.value.trim()
  if (wsEnabledEl.checked && !isAllowedWebSocketUrl(url)) {
    setStatus('WebSocket URL 은 loopback ws:// 또는 wss:// 여야 합니다.', true)
    return
  }
  await settingsStore.save({
    token: tokenEl.value,
    allowedDomains: normalizeDomainList(domainsEl.value.split('\n')),
    websocket: { enabled: wsEnabledEl.checked, url },
  })
  tokenWarning.hidden = tokenEl.value.trim() !== ''
  setStatus('저장됨')
})

$('refresh-log').addEventListener('click', () => void renderLog())

void load()
void renderLog()
