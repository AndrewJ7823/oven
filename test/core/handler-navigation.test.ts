import { describe, it, expect, vi } from 'vitest'
import { createHandler } from '../../src/core/handler'
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/settings'
import { FakeCookies } from '../fakes/cookies'
import { FakeNavigator } from '../fakes/navigator'

const NOW = 1_700_000_000

function setup(settings: Partial<Settings> = {}, nav = new FakeNavigator(7)) {
  const cookies = new FakeCookies()
  const merged: Settings = { ...DEFAULT_SETTINGS, ...settings }
  const handle = createHandler({ cookies, navigator: nav, settings: async () => merged, now: () => NOW, version: '0.1.0' })
  return { cookies, nav, handle }
}

const req = (over: Record<string, unknown> = {}) => ({
  type: 'cookies.replace',
  requestId: 'r1',
  cookies: [{ name: 'sid', value: 'v', domain: '.example.com', secure: true, sameSite: 'lax' }],
  ...over,
})

describe('FR-12 창 열기 → 쿠키 주입 → 새로고침', () => {
  it('AC-11 open 이 있으면 창을 먼저 열고, 쿠키를 주입한 뒤, 그 탭을 새로고침한다', async () => {
    const { handle, nav, cookies } = setup()
    const res = await handle(req({ open: { url: 'https://example.com/app' } }), { transport: 'external' })

    expect(res).toMatchObject({ ok: true, applied: 1, opened: { url: 'https://example.com/app', tabId: 7, reloaded: true } })
    expect(nav.opened).toEqual([{ url: 'https://example.com/app', focused: true }])
    expect(nav.reloaded).toEqual([7])
    expect(cookies.all()).toHaveLength(1)
    // 순서: 창 열기 → (쿠키 set) → 새로고침
    expect(nav.events).toEqual(['open:https://example.com/app', 'reload:7'])
    expect(cookies.setCalls).toHaveLength(1)
  })

  it('open 이 없으면 창/새로고침을 하지 않고 opened 도 없다', async () => {
    const { handle, nav } = setup()
    const res = await handle(req(), { transport: 'external' })
    expect(res).not.toHaveProperty('opened')
    expect(nav.opened).toHaveLength(0)
    expect(nav.reloaded).toHaveLength(0)
  })

  it('dryRun 이면 실제로 창을 열거나 새로고침하지 않고 계획만 보고한다', async () => {
    const { handle, nav, cookies } = setup()
    const res = await handle(req({ open: { url: 'https://example.com/app' }, options: { dryRun: true } }), { transport: 'external' })
    expect(res).toMatchObject({ dryRun: true, opened: { url: 'https://example.com/app', tabId: null, reloaded: false } })
    expect(nav.opened).toHaveLength(0)
    expect(nav.reloaded).toHaveLength(0)
    expect(cookies.setCalls).toHaveLength(0)
  })

  it('인증 실패 시 창을 열지 않는다', async () => {
    const { handle, nav } = setup({ token: 'secret' })
    const res = await handle(req({ open: { url: 'https://example.com/app' } }), { transport: 'external' })
    expect(res).toMatchObject({ ok: false, error: { code: 'E_UNAUTHORIZED' } })
    expect(nav.opened).toHaveLength(0)
  })

  it('창 열기에 실패하면 쿠키는 주입하되 새로고침은 건너뛰고 tabId=null 로 보고', async () => {
    const nav = new FakeNavigator(7)
    nav.openError = new Error('user closed')
    const { handle, cookies } = setup({}, nav)
    const res = await handle(req({ open: { url: 'https://example.com/app' } }), { transport: 'external' })
    expect(res).toMatchObject({ ok: true, applied: 1, opened: { url: 'https://example.com/app', tabId: null, reloaded: false } })
    expect(cookies.all()).toHaveLength(1)
    expect(nav.reloaded).toHaveLength(0)
  })

  it('탭 id 를 못 받으면(null) 새로고침을 건너뛴다', async () => {
    const { handle, nav } = setup({}, new FakeNavigator(null))
    const res = await handle(req({ open: { url: 'https://example.com/app' } }), { transport: 'external' })
    expect(res).toMatchObject({ opened: { tabId: null, reloaded: false } })
    expect(nav.reloaded).toHaveLength(0)
  })

  it('새로고침이 실패해도 쿠키 주입 결과는 성공으로 보고(reloaded=false)', async () => {
    const nav = new FakeNavigator(7)
    nav.reloadError = new Error('tab gone')
    const { handle } = setup({}, nav)
    const res = await handle(req({ open: { url: 'https://example.com/app' } }), { transport: 'external' })
    expect(res).toMatchObject({ ok: true, opened: { tabId: 7, reloaded: false } })
  })
})
