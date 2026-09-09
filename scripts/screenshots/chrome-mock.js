// 스크린샷용 chrome.* 목: storage.local/session, runtime, onChanged
const now = Date.now()
const stores = {
  local: { settings: { token: 'shared-secret', allowedDomains: ['example.com', 'internal.corp'], websocket: { enabled: true, url: 'ws://127.0.0.1:8765' } } },
  session: {
    connectionStatus: 'connected',
    activityLog: [
      { at: now - 12_000, transport: 'websocket', type: 'cookies.replace', ok: true, applied: 2, removed: 3, failedCount: 0 },
      { at: now - 95_000, transport: 'websocket', type: 'cookies.replace', ok: false, applied: 1, removed: 0, failedCount: 1 },
      { at: now - 400_000, transport: 'external', type: 'cookies.replace', ok: false, errorCode: 'E_UNAUTHORIZED' },
      { at: now - 3_600_000, transport: 'external', type: 'ping', ok: true },
    ],
  },
}
const area = (name) => ({
  get: async (key) => (key ? { [key]: stores[name][key] } : { ...stores[name] }),
  set: async (items) => Object.assign(stores[name], items),
})
window.chrome = {
  storage: { local: area('local'), session: area('session'), onChanged: { addListener() {} } },
  runtime: {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    getManifest: () => ({ version: '1.0.0' }),
    sendMessage: (_m, cb) => cb && cb(),
    openOptionsPage() {},
  },
}
