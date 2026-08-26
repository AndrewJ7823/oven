import type { Handler } from '../core/handler'
import { errorResponse } from '../core/protocol'

export interface WebSocketLike {
  readyState: number
  send(data: string): void
  close(): void
  addEventListener(type: 'open' | 'message' | 'close' | 'error', cb: (ev: any) => void): void
}
export type WebSocketFactory = (url: string) => WebSocketLike

export interface WebSocketTransportOptions {
  url: string
  handle: Handler
  factory: WebSocketFactory
  heartbeatMs?: number
  minBackoffMs?: number
  maxBackoffMs?: number
}

export type TransportState = 'idle' | 'connecting' | 'open' | 'closed'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const WS_OPEN = 1

/** FR-02: ws:// 는 loopback 만, 그 외 호스트는 wss:// 만 허용 */
export function isAllowedWebSocketUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'wss:') return true
  if (u.protocol === 'ws:') return LOOPBACK_HOSTS.has(u.hostname)
  return false
}

const requestIdOf = (m: unknown): string | null =>
  typeof m === 'object' && m !== null && typeof (m as { requestId?: unknown }).requestId === 'string'
    ? (m as { requestId: string }).requestId
    : null

/**
 * 외부 앱이 여는 로컬 WebSocket 서버에 클라이언트로 접속해 요청을 수신한다.
 * 재연결(지수 백오프) + 하트비트(서비스 워커 keep-alive) 포함. (FR-02, AC-10)
 */
export class WebSocketTransport {
  private ws: WebSocketLike | null = null
  private _state: TransportState = 'idle'
  private stopped = true
  private backoffMs: number
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatSeq = 0

  private readonly url: string
  private readonly handle: Handler
  private readonly factory: WebSocketFactory
  private readonly heartbeatMs: number
  private readonly minBackoffMs: number
  private readonly maxBackoffMs: number

  constructor(opts: WebSocketTransportOptions) {
    if (!isAllowedWebSocketUrl(opts.url)) {
      throw new Error(`WebSocket url must be ws:// on loopback or wss://: ${opts.url}`)
    }
    this.url = opts.url
    this.handle = opts.handle
    this.factory = opts.factory
    this.heartbeatMs = opts.heartbeatMs ?? 20_000
    this.minBackoffMs = opts.minBackoffMs ?? 1_000
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000
    this.backoffMs = this.minBackoffMs
  }

  get state(): TransportState {
    return this._state
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    const ws = this.ws
    this.ws = null
    this._state = 'idle'
    ws?.close()
  }

  private connect(): void {
    this._state = 'connecting'
    const ws = this.factory(this.url)
    this.ws = ws

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return
      this._state = 'open'
      this.backoffMs = this.minBackoffMs
      this.startHeartbeat()
    })
    ws.addEventListener('message', (ev: { data: unknown }) => {
      if (this.ws === ws) void this.onMessage(ws, ev.data)
    })
    ws.addEventListener('error', () => {
      /* close 이벤트가 뒤따르므로 여기서는 무시 */
    })
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return
      this.ws = null
      this.stopHeartbeat()
      if (this.stopped) return
      this._state = 'closed'
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped) this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping', requestId: `hb-${++this.heartbeatSeq}` })
    }, this.heartbeatMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private clearTimers(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private send(payload: unknown): void {
    const ws = this.ws
    if (!ws || ws.readyState !== WS_OPEN) return
    try {
      ws.send(JSON.stringify(payload))
    } catch {
      /* 전송 실패는 close 이벤트로 복구된다 */
    }
  }

  private async onMessage(ws: WebSocketLike, data: unknown): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(typeof data === 'string' ? data : String(data))
    } catch {
      this.send(errorResponse('E_INVALID_MESSAGE', 'payload is not valid JSON'))
      return
    }
    // 우리가 보낸 하트비트에 대한 서버 응답은 무시
    if (typeof parsed === 'object' && parsed !== null && (parsed as { type?: unknown }).type === 'pong') return

    let response: unknown
    try {
      response = await this.handle(parsed, { transport: 'websocket' })
    } catch {
      response = errorResponse('E_INTERNAL', 'internal error', { requestId: requestIdOf(parsed) })
    }
    if (this.ws === ws) this.send(response)
  }
}
