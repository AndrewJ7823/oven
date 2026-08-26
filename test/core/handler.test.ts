import { describe, it, expect, vi } from 'vitest'
import { createHandler } from '../../src/core/handler'
import type { Settings } from '../../src/core/settings'
import { DEFAULT_SETTINGS } from '../../src/core/settings'
import { FakeCookies } from '../fakes/cookies'

const NOW = 1_700_000_000

function setup(settings: Partial<Settings> = {}) {
  const cookies = new FakeCookies()
  const merged: Settings = { ...DEFAULT_SETTINGS, ...settings }
  const onResult = vi.fn()
  const handle = createHandler({ cookies, settings: async () => merged, now: () => NOW, version: '0.1.0', onResult })
  return { cookies, handle, onResult }
}

const validReplace = (over: Record<string, unknown> = {}) => ({
  type: 'cookies.replace',
  requestId: 'r1',
  cookies: [{ name: 'sid', value: 'v', domain: '.example.com' }],
  ...over,
})

describe('FR-10 ping', () => {
  it('AC-09 pong 과 version 을 반환하고 인증이 필요 없다', async () => {
    const { handle } = setup({ token: 'secret' })
    await expect(handle({ type: 'ping', requestId: 'p1' }, { transport: 'external' })).resolves.toEqual({
      requestId: 'p1',
      type: 'pong',
      ok: true,
      version: '0.1.0',
    })
  })
})

describe('FR-03 검증 실패 응답', () => {
  it('스키마 위반 → E_INVALID_MESSAGE 오류 응답 (requestId 보존)', async () => {
    const { handle, cookies } = setup()
    const res = await handle(validReplace({ cookies: [] }), { transport: 'external' })
    expect(res).toMatchObject({ requestId: 'r1', type: 'cookies.replace', ok: false, error: { code: 'E_INVALID_MESSAGE' } })
    expect(cookies.all()).toHaveLength(0)
  })
  it('type 이 없으면 type: null 로 응답', async () => {
    const { handle } = setup()
    expect(await handle({ foo: 1 }, { transport: 'external' })).toMatchObject({ requestId: null, type: null, ok: false })
  })
  it('알 수 없는 type → E_UNKNOWN_TYPE', async () => {
    const { handle } = setup()
    expect(await handle({ type: 'nope' }, { transport: 'external' })).toMatchObject({ ok: false, error: { code: 'E_UNKNOWN_TYPE' } })
  })
})

describe('FR-04 인증', () => {
  it('AC-04 토큰 설정 상태에서 누락 → E_UNAUTHORIZED, 저장소 변화 없음', async () => {
    const { handle, cookies } = setup({ token: 'secret' })
    const res = await handle(validReplace(), { transport: 'external' })
    expect(res).toMatchObject({ ok: false, error: { code: 'E_UNAUTHORIZED' } })
    expect(cookies.all()).toHaveLength(0)
  })
  it('토큰 불일치 → E_UNAUTHORIZED', async () => {
    const { handle } = setup({ token: 'secret' })
    expect(await handle(validReplace({ token: 'wrong' }), { transport: 'external' })).toMatchObject({ error: { code: 'E_UNAUTHORIZED' } })
  })
  it('토큰 일치 → 처리 진행', async () => {
    const { handle, cookies } = setup({ token: 'secret' })
    expect(await handle(validReplace({ token: 'secret' }), { transport: 'external' })).toMatchObject({ ok: true, applied: 1 })
    expect(cookies.all()).toHaveLength(1)
  })
  it('토큰이 비어 있으면 인증 생략', async () => {
    const { handle } = setup({ token: '' })
    expect(await handle(validReplace(), { transport: 'external' })).toMatchObject({ ok: true })
  })
})

describe('FR-05 도메인 허용 목록', () => {
  it('AC-05 허용 목록 외 도메인 포함 → 요청 전체 거부', async () => {
    const { handle, cookies } = setup({ allowedDomains: ['ok.com'] })
    const res = await handle(
      validReplace({
        cookies: [
          { name: 'a', value: '1', domain: '.ok.com' },
          { name: 'b', value: '2', domain: '.evil.com' },
        ],
      }),
      { transport: 'external' },
    )
    expect(res).toMatchObject({ ok: false, error: { code: 'E_DOMAIN_NOT_ALLOWED', message: expect.stringContaining('evil.com') } })
    expect(cookies.all()).toHaveLength(0)
  })
  it('모두 허용 도메인이면 처리', async () => {
    const { handle } = setup({ allowedDomains: ['example.com'] })
    expect(await handle(validReplace(), { transport: 'external' })).toMatchObject({ ok: true })
  })
})

describe('FR-11 결과 콜백(로그용)', () => {
  it('처리 결과를 onResult 로 통지하며 쿠키 값은 포함하지 않는다', async () => {
    const { handle, onResult } = setup()
    await handle(validReplace(), { transport: 'websocket' })
    expect(onResult).toHaveBeenCalledTimes(1)
    const [response, meta] = onResult.mock.calls[0]!
    expect(meta).toEqual({ transport: 'websocket' })
    expect(JSON.stringify(response)).not.toContain('"v"')
  })
  it('오류 응답도 통지한다', async () => {
    const { handle, onResult } = setup({ token: 't' })
    await handle(validReplace(), { transport: 'external' })
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ok: false }), { transport: 'external' })
  })
})
