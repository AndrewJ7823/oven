import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings, createSettingsStore, SETTINGS_KEY } from '../../src/core/settings'
import { FakeStorageArea } from '../fakes/storage'

describe('FR-11 설정', () => {
  it('기본값: 토큰 없음, 허용 목록 없음, WebSocket 비활성(ws://127.0.0.1:8765)', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      token: '',
      allowedDomains: [],
      websocket: { enabled: false, url: 'ws://127.0.0.1:8765' },
    })
  })

  it('normalizeSettings 는 누락/잘못된 필드를 기본값으로 채운다', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ token: 42, allowedDomains: 'x', websocket: null })).toEqual(DEFAULT_SETTINGS)
  })

  it('allowedDomains 는 trim/소문자/선행 . 제거/빈값 제거/중복 제거', () => {
    const s = normalizeSettings({ allowedDomains: [' .Example.COM ', '', 'example.com', 'B.io'] })
    expect(s.allowedDomains).toEqual(['example.com', 'b.io'])
  })

  it('token 은 trim 된다', () => {
    expect(normalizeSettings({ token: '  abc ' }).token).toBe('abc')
  })

  it('store: 저장 후 로드하면 같은 값, 부분 저장은 병합', async () => {
    const area = new FakeStorageArea()
    const store = createSettingsStore(area)
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)

    await store.save({ token: 'abc' })
    await store.save({ websocket: { enabled: true, url: 'ws://127.0.0.1:9000' } })

    expect(await store.load()).toEqual({
      token: 'abc',
      allowedDomains: [],
      websocket: { enabled: true, url: 'ws://127.0.0.1:9000' },
    })
    expect(area.data[SETTINGS_KEY]).toBeDefined()
  })
})
