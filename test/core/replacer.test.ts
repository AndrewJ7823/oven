import { describe, it, expect } from 'vitest'
import { replaceCookies } from '../../src/core/replacer'
import type { ReplaceRequest, NormalizedCookie } from '../../src/core/protocol'
import { FakeCookies } from '../fakes/cookies'

const NOW = 1_700_000_000
const deps = { now: () => NOW }

const cookie = (over: Partial<NormalizedCookie> = {}): NormalizedCookie => ({
  name: 'sid',
  value: 'new',
  domain: '.example.com',
  path: '/',
  secure: true,
  httpOnly: false,
  hostOnly: false,
  sameSite: 'lax',
  ...over,
})

const request = (over: Partial<ReplaceRequest> = {}): ReplaceRequest => ({
  type: 'cookies.replace',
  requestId: 'r1',
  mode: 'merge',
  options: { dryRun: false },
  cookies: [cookie()],
  ...over,
})

describe('FR-06 merge 모드', () => {
  it('AC-01 유효한 요청 1건 → applied 1, 저장소에 존재', async () => {
    const api = new FakeCookies()
    const res = await replaceCookies(api, request(), deps)
    expect(res).toEqual({ requestId: 'r1', type: 'cookies.replace', ok: true, applied: 1, removed: 0, failed: [], dryRun: false })
    expect(api.all()).toMatchObject([{ name: 'sid', value: 'new', domain: '.example.com', path: '/', secure: true, sameSite: 'lax' }])
  })

  it('AC-02 같은 name/domain/path 재전송 시 덮어쓰기(개수 유지)', async () => {
    const api = new FakeCookies()
    api.seed({ name: 'sid', value: 'old', domain: '.example.com' })
    api.seed({ name: 'other', value: 'keep', domain: '.example.com' })
    const res = await replaceCookies(api, request(), deps)
    expect(res.applied).toBe(1)
    expect(api.all()).toHaveLength(2)
    expect(api.all().find((c) => c.name === 'sid')?.value).toBe('new')
    expect(api.all().find((c) => c.name === 'other')?.value).toBe('keep')
  })

  it('merge 모드는 다른 쿠키를 삭제하지 않는다 (remove 미호출)', async () => {
    const api = new FakeCookies()
    api.seed({ name: 'x', domain: '.example.com' })
    await replaceCookies(api, request(), deps)
    expect(api.removeCalls).toHaveLength(0)
  })

  it('hostOnly 쿠키는 host-only 로 저장된다', async () => {
    const api = new FakeCookies()
    await replaceCookies(api, request({ cookies: [cookie({ hostOnly: true, domain: 'example.com' })] }), deps)
    expect(api.all()[0]).toMatchObject({ hostOnly: true, domain: 'example.com' })
  })

  it('만료 시각이 미래인 쿠키는 expirationDate 를 유지한다', async () => {
    const api = new FakeCookies()
    await replaceCookies(api, request({ cookies: [cookie({ expirationDate: NOW + 60 })] }), deps)
    expect(api.all()[0]).toMatchObject({ session: false, expirationDate: NOW + 60 })
  })
})

describe('FR-07 replace 모드', () => {
  it('AC-03 대상 도메인의 기존 쿠키만 삭제하고 하위 도메인 쿠키는 유지', async () => {
    const api = new FakeCookies()
    api.seed({ name: 'a', domain: '.example.com' })
    api.seed({ name: 'b', domain: '.example.com', path: '/p' })
    api.seed({ name: 'c', domain: 'example.com' })
    api.seed({ name: 'sub', domain: '.api.example.com' })
    api.seed({ name: 'other', domain: '.other.com' })

    const res = await replaceCookies(api, request({ mode: 'replace' }), deps)

    expect(res).toMatchObject({ ok: true, applied: 1, removed: 3 })
    const names = api.all().map((c) => c.name).sort()
    expect(names).toEqual(['other', 'sid', 'sub'])
  })

  it('여러 도메인이 섞여 있으면 각 도메인별로 삭제한다', async () => {
    const api = new FakeCookies()
    api.seed({ name: 'a', domain: '.a.com' })
    api.seed({ name: 'b', domain: '.b.com' })
    api.seed({ name: 'z', domain: '.z.com' })
    const res = await replaceCookies(
      api,
      request({ mode: 'replace', cookies: [cookie({ domain: '.a.com' }), cookie({ domain: 'b.com', hostOnly: true })] }),
      deps,
    )
    expect(res.removed).toBe(2)
    expect(api.all().map((c) => c.name).sort()).toEqual(['sid', 'sid', 'z'])
  })
})

describe('FR-08 부분 실패', () => {
  it('AC-06 만료 쿠키 + 정상 쿠키 → ok false, applied 1, failed E_EXPIRED', async () => {
    const api = new FakeCookies()
    const res = await replaceCookies(
      api,
      request({ cookies: [cookie({ name: 'dead', expirationDate: NOW - 1 }), cookie({ name: 'alive' })] }),
      deps,
    )
    expect(res.ok).toBe(false)
    expect(res.applied).toBe(1)
    expect(res.failed).toEqual([{ name: 'dead', domain: '.example.com', path: '/', code: 'E_EXPIRED', message: expect.any(String) }])
    expect(api.all().map((c) => c.name)).toEqual(['alive'])
  })

  it('만료 시각이 정확히 now 인 쿠키도 만료로 취급', async () => {
    const api = new FakeCookies()
    const res = await replaceCookies(api, request({ cookies: [cookie({ expirationDate: NOW })] }), deps)
    expect(res.failed[0]?.code).toBe('E_EXPIRED')
  })

  it('set 이 null 을 반환하면 E_SET_FAILED 로 보고하고 나머지는 계속 처리', async () => {
    const api = new FakeCookies()
    api.failOn('bad')
    const res = await replaceCookies(api, request({ cookies: [cookie({ name: 'bad' }), cookie({ name: 'good' })] }), deps)
    expect(res.ok).toBe(false)
    expect(res.applied).toBe(1)
    expect(res.failed).toMatchObject([{ name: 'bad', code: 'E_SET_FAILED' }])
  })

  it('set 이 예외를 던져도 E_SET_FAILED 로 수집한다', async () => {
    const api = new FakeCookies()
    api.set = async () => {
      throw new Error('boom')
    }
    const res = await replaceCookies(api, request(), deps)
    expect(res.failed).toMatchObject([{ code: 'E_SET_FAILED', message: expect.stringContaining('boom') }])
  })
})

describe('FR-09 dryRun', () => {
  it('AC-07 저장소를 변경하지 않고 예정 작업 수만 반환', async () => {
    const api = new FakeCookies()
    api.seed({ name: 'a', domain: '.example.com' })
    api.seed({ name: 'b', domain: '.example.com' })
    const res = await replaceCookies(
      api,
      request({ mode: 'replace', options: { dryRun: true }, cookies: [cookie(), cookie({ name: 'dead', expirationDate: NOW - 1 })] }),
      deps,
    )
    expect(res).toMatchObject({ ok: false, applied: 1, removed: 2, dryRun: true })
    expect(res.failed).toHaveLength(1)
    expect(api.setCalls).toHaveLength(0)
    expect(api.removeCalls).toHaveLength(0)
    expect(api.all()).toHaveLength(2)
  })
})
