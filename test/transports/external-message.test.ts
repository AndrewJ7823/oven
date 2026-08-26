import { describe, it, expect, vi } from 'vitest'
import { attachExternalMessageTransport } from '../../src/transports/external-message'
import { FakeExternalMessageEvent } from '../fakes/runtime'

describe('FR-01 externally_connectable 트랜스포트', () => {
  it('수신 메시지를 handler 에 전달하고 응답을 sendResponse 로 돌려준다', async () => {
    const event = new FakeExternalMessageEvent()
    const handle = vi.fn(async () => ({ requestId: 'r', type: 'pong' as const, ok: true as const, version: '1' }))
    attachExternalMessageTransport(event, handle)

    const res = await event.dispatch({ type: 'ping', requestId: 'r' }, { origin: 'http://localhost:3000', id: undefined })

    expect(handle).toHaveBeenCalledWith({ type: 'ping', requestId: 'r' }, { transport: 'external', origin: 'http://localhost:3000' })
    expect(res).toEqual({ requestId: 'r', type: 'pong', ok: true, version: '1' })
  })

  it('handler 가 예외를 던지면 E_INTERNAL 오류 응답을 보낸다', async () => {
    const event = new FakeExternalMessageEvent()
    attachExternalMessageTransport(event, async () => {
      throw new Error('kaboom')
    })
    const res = await event.dispatch({ type: 'ping', requestId: 'r' })
    expect(res).toMatchObject({ requestId: 'r', ok: false, error: { code: 'E_INTERNAL' } })
    expect(JSON.stringify(res)).not.toContain('kaboom')
  })

  it('리스너는 한 번만 등록된다', () => {
    const event = new FakeExternalMessageEvent()
    attachExternalMessageTransport(event, async () => ({ requestId: null, type: 'pong', ok: true, version: '1' }))
    expect(event.listenerCount).toBe(1)
  })
})
