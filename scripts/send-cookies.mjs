#!/usr/bin/env node
/**
 * `pnpm send` — 도메인과 쿠키를 익스텐션에 보내는 CLI. (FR-14)
 *   pnpm send --domain .example.com sid=abc theme=dark [--token SECRET] [--open URL] ...
 *
 * 익스텐션은 서버를 열 수 없으므로 이 스크립트가 로컬 WebSocket 서버를 열고,
 * 익스텐션(옵션 → WebSocket 수신 ON)이 접속하면 즉시 cookies.replace 를 보내고 응답을 출력한 뒤 종료한다.
 * 순수 로직(인자 파싱·요청 생성·세션·출력)은 src/cli/send-request.ts 에 있고 여기서는 I/O 만 담당한다.
 * Node 22.6+ (타입 스트리핑) 필요.
 */
import { readFileSync } from 'node:fs'
import { WebSocketServer } from 'ws'
import { parseSendArgs, parseCookiesJson, buildReplaceRequest, runSendSession, formatResult, USAGE, EXIT } from '../src/cli/send-request.ts'

const log = (...args) => console.error('[send]', ...args)

const parsed = parseSendArgs(process.argv.slice(2), process.env)
if (!parsed.ok) {
  console.error(`오류: ${parsed.message}\n`)
  console.error(USAGE)
  process.exit(EXIT.USAGE)
}
if (parsed.help) {
  console.log(USAGE)
  process.exit(EXIT.OK)
}

const options = parsed.options
if (options.jsonFile !== undefined) {
  try {
    const text = readFileSync(options.jsonFile === '-' ? 0 : options.jsonFile, 'utf8')
    options.cookies = [...options.cookies, ...parseCookiesJson(text, options.domain)]
  } catch (e) {
    console.error(`오류: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(EXIT.USAGE)
  }
  if (options.cookies.length === 0) {
    console.error('오류: --json 파일에 쿠키가 없습니다')
    process.exit(EXIT.USAGE)
  }
}
if (!options.token) log('경고: 토큰 없이 전송합니다 (익스텐션 옵션의 토큰이 비어 있어야 통과)')

const request = buildReplaceRequest(options, { requestId: crypto.randomUUID() })

const wss = new WebSocketServer({ host: options.host, port: options.port })
const domains = [...new Set(request.cookies.map((c) => c.domain))].join(', ')

const shutdown = (code) => {
  wss.close()
  for (const client of wss.clients) client.terminate()
  process.exit(code)
}

wss.on('error', (err) => {
  console.error(`오류: 서버를 열 수 없습니다 (ws://${options.host}:${options.port}): ${err.message}`)
  process.exit(EXIT.NO_CONNECTION)
})

wss.on('listening', () => {
  log(`ws://${options.host}:${options.port} 에서 익스텐션 접속 대기 중… (${options.timeoutMs}ms)`)
  log(`보낼 내용: ${request.cookies.length}개 쿠키 → ${domains} [${request.mode}${request.options.dryRun ? ', dry-run' : ''}${request.open ? `, open ${request.open.url}` : ''}]`)
})

const connectTimer = setTimeout(() => {
  console.error(`오류: ${options.timeoutMs}ms 안에 익스텐션이 접속하지 않았습니다. 옵션 페이지에서 WebSocket 수신이 켜져 있고 URL 이 ws://${options.host}:${options.port} 인지 확인하세요.`)
  shutdown(EXIT.NO_CONNECTION)
}, options.timeoutMs)

let claimed = false
wss.on('connection', async (ws) => {
  if (claimed) {
    ws.close()
    return
  }
  claimed = true
  clearTimeout(connectTimer)
  log('익스텐션 접속됨 → 요청 전송')

  const socket = {
    send: (data) => ws.send(data),
    onMessage: (cb) => ws.on('message', (buf) => cb(buf.toString())),
    onClose: (cb) => ws.on('close', cb),
  }

  try {
    const response = await runSendSession(socket, request, { timeoutMs: options.timeoutMs })
    const result = formatResult(response)
    for (const line of result.lines) console.log(line)
    shutdown(result.exitCode)
  } catch (e) {
    console.error(`오류: ${e instanceof Error ? e.message : String(e)}`)
    shutdown(EXIT.NO_CONNECTION)
  }
})
