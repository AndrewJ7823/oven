/**
 * 외부 앱 역할을 하는 예제 WebSocket 서버 (수동 E2E 용).
 *   pnpm ws:example [--token SECRET]
 * 옵션 페이지에서 WebSocket 수신을 켜고 ws://127.0.0.1:8765 로 접속하면
 * 연결 직후 예제 쿠키 교체 요청을 보내고 응답을 출력한다.
 */
import { WebSocketServer } from 'ws'

const tokenIdx = process.argv.indexOf('--token')
const token = tokenIdx >= 0 ? process.argv[tokenIdx + 1] : undefined
const port = 8765

const wss = new WebSocketServer({ host: '127.0.0.1', port })
console.log(`[example] listening on ws://127.0.0.1:${port}${token ? ' (token auth)' : ''}`)

wss.on('connection', (ws) => {
  console.log('[example] extension connected')

  ws.on('message', (buf) => {
    const msg = JSON.parse(buf.toString())
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ requestId: msg.requestId, type: 'pong', ok: true }))
      return
    }
    console.log('[example] response:', JSON.stringify(msg, null, 2))
  })

  const request = {
    type: 'cookies.replace',
    requestId: crypto.randomUUID(),
    token,
    mode: 'merge',
    cookies: [
      {
        name: 'oven_demo',
        value: `set-at-${Date.now()}`,
        domain: 'localhost',
        hostOnly: true,
        path: '/',
        secure: false,
        httpOnly: false,
        sameSite: 'lax',
        expirationDate: Math.floor(Date.now() / 1000) + 3600,
      },
    ],
  }
  ws.send(JSON.stringify(request))
  console.log('[example] sent cookies.replace', request.requestId)
})
