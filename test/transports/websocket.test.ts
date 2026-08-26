import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSocketTransport, isAllowedWebSocketUrl } from '../../src/transports/websocket'
import { FakeWebSocket } from '../fakes/websocket'

const pong = { requestId: 'r', type: 'pong' as const, ok: true as const, version: '1' }

function make(handle = vi.fn(async () => pong), url = 'ws://127.0.0.1:8765') {
  const t = new WebSocketTransport({ url, handle, factory: (u) => new FakeWebSocket(u) })
  return { t, handle }
}

const flush = () => new Promise<void>((r) => setImmediate(r))

describe('FR-02 WebSocket URL 정책', () => {
  it.each(['ws://127.0.0.1:8765', 'ws://localhost:1234/path', 'ws://[::1]:9', 'wss://example.com'])('%s 허용', (u) => {
    expect(isAllowedWebSocketUrl(u)).toBe(true)
  })
  it.each(['ws://example.com', 'ws://192.168.0.2:8765', 'http://127.0.0.1', 'not a url', ''])('%s 거부', (u) => {
    expect(isAllowedWebSocketUrl(u)).toBe(false)
  })
  it('허용되지 않는 URL 로 생성하면 예외', () => {
    expect(() => make(undefined, 'ws://evil.com')).toThrow(/loopback|wss/i)
  })
})

describe('FR-02 WebSocket 트랜스포트', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    FakeWebSocket.reset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('start 시 설정 URL 로 연결하고 state 가 connecting → open 으로 바뀐다', () => {
    const { t } = make()
    expect(t.state).toBe('idle')
    t.start()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.last.url).toBe('ws://127.0.0.1:8765')
    expect(t.state).toBe('connecting')
    FakeWebSocket.last.open()
    expect(t.state).toBe('open')
  })

  it('수신 JSON 을 handler 에 전달하고 응답을 같은 소켓으로 보낸다', async () => {
    const { t, handle } = make()
    t.start()
    FakeWebSocket.last.open()
    FakeWebSocket.last.receive({ type: 'ping', requestId: 'r' })
    await flush()
    expect(handle).toHaveBeenCalledWith({ type: 'ping', requestId: 'r' }, { transport: 'websocket' })
    expect(FakeWebSocket.last.sentJson()).toContainEqual(pong)
  })

  it('JSON 파싱 실패 시 E_INVALID_MESSAGE 오류를 회신하고 handler 는 호출하지 않는다', async () => {
    const { t, handle } = make()
    t.start()
    FakeWebSocket.last.open()
    FakeWebSocket.last.receive('{not json')
    await flush()
    expect(handle).not.toHaveBeenCalled()
    expect(FakeWebSocket.last.sentJson()).toContainEqual(
      expect.objectContaining({ ok: false, requestId: null, error: expect.objectContaining({ code: 'E_INVALID_MESSAGE' }) }),
    )
  })

  it('서버의 pong 응답은 무시한다 (핑퐁 루프 방지)', async () => {
    const { t, handle } = make()
    t.start()
    FakeWebSocket.last.open()
    FakeWebSocket.last.receive({ type: 'pong', ok: true })
    await flush()
    expect(handle).not.toHaveBeenCalled()
    expect(FakeWebSocket.last.sent).toHaveLength(0)
  })

  it('handler 예외 시 E_INTERNAL 회신', async () => {
    const { t } = make(
      vi.fn(async () => {
        throw new Error('x')
      }) as never,
    )
    t.start()
    FakeWebSocket.last.open()
    FakeWebSocket.last.receive({ type: 'ping', requestId: 'q' })
    await flush()
    expect(FakeWebSocket.last.sentJson()).toContainEqual(expect.objectContaining({ requestId: 'q', error: expect.objectContaining({ code: 'E_INTERNAL' }) }))
  })

  it('AC-10 연결 후 20초마다 ping 하트비트를 보낸다', () => {
    const { t } = make()
    t.start()
    FakeWebSocket.last.open()
    vi.advanceTimersByTime(20_000)
    expect(FakeWebSocket.last.sentJson()).toEqual([expect.objectContaining({ type: 'ping' })])
    vi.advanceTimersByTime(20_000)
    expect(FakeWebSocket.last.sent).toHaveLength(2)
  })

  it('AC-10 끊기면 지수 백오프(1s,2s,4s…최대 30s)로 재연결하고, 성공하면 백오프가 초기화된다', () => {
    const { t } = make()
    t.start()
    FakeWebSocket.last.open()
    FakeWebSocket.last.closeFromServer()
    expect(t.state).toBe('closed')

    vi.advanceTimersByTime(999)
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(2) // 1s 후 재연결

    FakeWebSocket.last.fail()
    vi.advanceTimersByTime(2_000)
    expect(FakeWebSocket.instances).toHaveLength(3) // 2s

    FakeWebSocket.last.fail()
    vi.advanceTimersByTime(4_000)
    expect(FakeWebSocket.instances).toHaveLength(4) // 4s

    // 연속 실패 시 30s 상한
    for (let i = 0; i < 5; i++) {
      FakeWebSocket.last.fail()
      vi.advanceTimersByTime(30_000)
    }
    const countAfterCap = FakeWebSocket.instances.length
    FakeWebSocket.last.fail()
    vi.advanceTimersByTime(29_999)
    expect(FakeWebSocket.instances).toHaveLength(countAfterCap)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(countAfterCap + 1)

    // 성공 → 백오프 초기화
    FakeWebSocket.last.open()
    FakeWebSocket.last.closeFromServer()
    vi.advanceTimersByTime(1_000)
    expect(FakeWebSocket.instances).toHaveLength(countAfterCap + 2)
  })

  it('stop 하면 소켓을 닫고 재연결/하트비트를 중단한다', () => {
    const { t } = make()
    t.start()
    FakeWebSocket.last.open()
    t.stop()
    expect(FakeWebSocket.last.closedByClient).toBe(true)
    expect(t.state).toBe('idle')
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('start 를 두 번 호출해도 연결은 하나만 만든다', () => {
    const { t } = make()
    t.start()
    t.start()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('끊긴 상태에서 하트비트는 전송하지 않는다 (예외 없음)', () => {
    const { t } = make()
    t.start()
    FakeWebSocket.last.open()
    FakeWebSocket.last.closeFromServer()
    expect(() => vi.advanceTimersByTime(20_000)).not.toThrow()
    expect(FakeWebSocket.instances[0]!.sent).toHaveLength(0)
  })
})

describe('FR-13 상태 변경 콜백', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    FakeWebSocket.reset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('연결/해제 시 onStateChange 로 상태를 통지한다', () => {
    const states: string[] = []
    const t = new WebSocketTransport({
      url: 'ws://127.0.0.1:8765',
      handle: vi.fn(async () => pong),
      factory: (u) => new FakeWebSocket(u),
      onStateChange: (s) => states.push(s),
    })
    t.start()
    FakeWebSocket.last.open()
    FakeWebSocket.last.closeFromServer()
    t.stop()
    expect(states).toEqual(['connecting', 'open', 'closed', 'idle'])
  })
})
