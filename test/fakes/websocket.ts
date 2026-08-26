import type { WebSocketLike } from '../../src/transports/websocket'

type EventName = 'open' | 'message' | 'close' | 'error'

/** 브라우저 WebSocket 페이크. 테스트가 서버 역할을 하며 open()/receive()/closeFromServer() 로 이벤트를 발생시킨다. */
export class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = []
  static reset(): void {
    FakeWebSocket.instances = []
  }
  static get last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1)
    if (!ws) throw new Error('no FakeWebSocket instance')
    return ws
  }

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readyState = 0
  sent: string[] = []
  closedByClient = false
  private handlers: Record<EventName, ((ev: any) => void)[]> = { open: [], message: [], close: [], error: [] }

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: EventName, cb: (ev: any) => void): void {
    this.handlers[type].push(cb)
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('InvalidStateError: socket not open')
    this.sent.push(data)
  }

  close(): void {
    this.closedByClient = true
    this.readyState = 3
    this.emit('close', { code: 1000 })
  }

  // ── 서버 측 시뮬레이션 ──
  open(): void {
    this.readyState = 1
    this.emit('open', {})
  }
  receive(data: unknown): void {
    this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
  closeFromServer(code = 1006): void {
    this.readyState = 3
    this.emit('close', { code })
  }
  fail(): void {
    this.emit('error', {})
    this.closeFromServer(1006)
  }

  sentJson(): unknown[] {
    return this.sent.map((s) => JSON.parse(s))
  }

  private emit(type: EventName, ev: unknown): void {
    for (const h of this.handlers[type]) h(ev)
  }
}
