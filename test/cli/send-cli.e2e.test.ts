/**
 * FR-14 통합: 실제 CLI(scripts/send-cookies.mjs)를 자식 프로세스로 띄우고,
 * 실제 코어 핸들러 + WebSocketTransport 를 익스텐션 역할로 접속시켜 전 구간을 검증한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { createHandler } from '../../src/core/handler'
import { WebSocketTransport } from '../../src/transports/websocket'
import { FakeCookies } from '../fakes/cookies'
import { FakeNavigator } from '../fakes/navigator'

const CLI = 'scripts/send-cookies.mjs'

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port'))))
    })
  })
}

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[], env: Record<string, string> = {}, stdin?: string): { child: ChildProcess; done: Promise<CliResult> } {
  const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout!.on('data', (d) => (stdout += String(d)))
  child.stderr!.on('data', (d) => (stderr += String(d)))
  if (stdin !== undefined) child.stdin!.end(stdin)
  else child.stdin!.end()
  const done = new Promise<CliResult>((resolve) => child.on('close', (code) => resolve({ code, stdout, stderr })))
  return { child, done }
}

/** stderr 에 접속 대기 메시지가 찍힐 때까지 기다린다 (서버 listening). */
function waitForListening(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const onData = (d: Buffer) => {
      if (String(d).includes('접속 대기')) {
        child.stderr!.off('data', onData)
        resolve()
      }
    }
    child.stderr!.on('data', onData)
  })
}

function fakeExtension(port: number, token: string) {
  const cookies = new FakeCookies()
  cookies.seed({ name: 'stale', domain: '.example.com', value: 'old' })
  const nav = new FakeNavigator(42)
  const handle = createHandler({
    cookies,
    navigator: nav,
    settings: async () => ({ token, allowedDomains: [], websocket: { enabled: true, url: '' } }),
    now: () => Math.floor(Date.now() / 1000),
    version: 'e2e',
  })
  const transport = new WebSocketTransport({
    url: `ws://127.0.0.1:${port}`,
    handle,
    factory: (u) => new WebSocket(u),
    heartbeatMs: 100,
    minBackoffMs: 50,
  })
  return { cookies, nav, transport }
}

describe('FR-14 pnpm send — CLI ↔ 익스텐션 통합', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    for (const c of cleanups.splice(0)) c()
  })

  it('replace 모드 + open + 토큰: 쿠키가 교체되고 창 열기→새로고침 순서로 처리된다', async () => {
    const port = await freePort()
    const { child, done } = runCli(
      ['-d', '.example.com', 'sid=abc', 'theme=dark', '--mode', 'replace', '--secure', '--http-only', '--expires', '1h', '-o', 'https://example.com/app', '--port', String(port), '--timeout', '8000'],
      { OVEN_TOKEN: 'secret' },
    )
    cleanups.push(() => child.kill())
    await waitForListening(child)

    const ext = fakeExtension(port, 'secret')
    cleanups.push(() => ext.transport.stop())
    ext.transport.start()

    const result = await done
    expect(result.stderr).toContain('익스텐션 접속됨')
    expect(result.stdout).toMatch(/✓ applied 2, removed 1, failed 0/)
    expect(result.stdout).toMatch(/opened https:\/\/example\.com\/app → tab 42, reloaded/)
    expect(result.code).toBe(0)

    const names = ext.cookies.all().map((c) => c.name).sort()
    expect(names).toEqual(['sid', 'theme'])
    expect(ext.cookies.all().every((c) => c.secure && c.httpOnly && c.domain === '.example.com' && !c.session)).toBe(true)
    expect(ext.nav.events).toEqual(['open:https://example.com/app', 'reload:42'])
    // 쿠키 값은 출력에 나오지 않는다 (NFR-04)
    expect(result.stdout + result.stderr).not.toContain('abc')
  }, 15_000)

  it('토큰 불일치 → E_UNAUTHORIZED, exit 1', async () => {
    const port = await freePort()
    const { child, done } = runCli(['-d', '.example.com', 'sid=abc', '-t', 'wrong', '--port', String(port), '--timeout', '8000'])
    cleanups.push(() => child.kill())
    await waitForListening(child)
    const ext = fakeExtension(port, 'secret')
    cleanups.push(() => ext.transport.stop())
    ext.transport.start()

    const result = await done
    expect(result.stdout).toMatch(/✗ E_UNAUTHORIZED: token mismatch/)
    expect(result.code).toBe(1)
    expect(ext.cookies.all().map((c) => c.name)).toEqual(['stale'])
  }, 15_000)

  it('--json - (stdin) + --dry-run: 저장 없이 예정 수만 보고', async () => {
    const port = await freePort()
    const json = JSON.stringify({ cookies: [{ name: 'a', value: '1' }, { name: 'b', value: '2', domain: 'other.com', hostOnly: true }] })
    const { child, done } = runCli(['-d', '.example.com', '--json', '-', '--dry-run', '--port', String(port), '--timeout', '8000'], {}, json)
    cleanups.push(() => child.kill())
    await waitForListening(child)
    const ext = fakeExtension(port, '')
    cleanups.push(() => ext.transport.stop())
    ext.transport.start()

    const result = await done
    expect(result.stderr).toContain('2개 쿠키 → .example.com, other.com')
    expect(result.stdout).toMatch(/✓ applied 2, removed 0, failed 0 \(dry-run\)/)
    expect(result.code).toBe(0)
    expect(ext.cookies.all().map((c) => c.name)).toEqual(['stale'])
  }, 15_000)

  it('익스텐션이 거부하는 쿠키 이름 → E_INVALID_MESSAGE, exit 1', async () => {
    const port = await freePort()
    const { child, done } = runCli(['-d', '.example.com', 'bad name=1', '--port', String(port), '--timeout', '8000'])
    cleanups.push(() => child.kill())
    await waitForListening(child)
    const ext = fakeExtension(port, '')
    cleanups.push(() => ext.transport.stop())
    ext.transport.start()

    const result = await done
    expect(result.stdout).toMatch(/✗ E_INVALID_MESSAGE: cookies\[0\]\.name/)
    expect(result.code).toBe(1)
  }, 15_000)

  it('아무도 접속하지 않으면 시간 초과, exit 3', async () => {
    const port = await freePort()
    const { done } = runCli(['-d', '.example.com', 'a=1', '--port', String(port), '--timeout', '300'])
    const result = await done
    expect(result.stderr).toMatch(/300ms 안에 익스텐션이 접속하지 않았습니다/)
    expect(result.code).toBe(3)
  }, 15_000)

  it('인자 오류 → 사용법 출력, exit 2', async () => {
    const { done } = runCli(['a=1'])
    const result = await done
    expect(result.stderr).toMatch(/--domain <host> is required/)
    expect(result.stderr).toMatch(/사용법: pnpm send/)
    expect(result.code).toBe(2)
  })
})
