import { describe, it, expect } from 'vitest'
import { createActivityLog, summarize, MAX_LOG_ENTRIES } from '../../src/core/activity-log'
import { FakeStorageArea } from '../fakes/storage'

describe('FR-11 처리 로그', () => {
  it('summarize: 성공 응답 → 카운트만 기록', () => {
    const entry = summarize(
      { requestId: 'r', type: 'cookies.replace', ok: false, applied: 2, removed: 1, failed: [{ name: 'x', domain: 'd', path: '/', code: 'E_EXPIRED', message: 'm' }], dryRun: false },
      { transport: 'external' },
      123,
    )
    expect(entry).toEqual({ at: 123, transport: 'external', type: 'cookies.replace', ok: false, applied: 2, removed: 1, failedCount: 1 })
  })

  it('summarize: 오류 응답 → errorCode 기록', () => {
    const entry = summarize({ requestId: null, type: null, ok: false, error: { code: 'E_UNAUTHORIZED', message: 'x' } }, { transport: 'websocket' }, 1)
    expect(entry).toEqual({ at: 1, transport: 'websocket', type: null, ok: false, errorCode: 'E_UNAUTHORIZED' })
  })

  it('summarize: pong', () => {
    expect(summarize({ requestId: 'p', type: 'pong', ok: true, version: '1' }, { transport: 'external' }, 5)).toEqual({
      at: 5,
      transport: 'external',
      type: 'pong',
      ok: true,
    })
  })

  it(`append 는 최신순으로 최대 ${MAX_LOG_ENTRIES}건만 유지`, async () => {
    const log = createActivityLog(new FakeStorageArea())
    for (let i = 0; i < MAX_LOG_ENTRIES + 5; i++) {
      await log.append({ at: i, transport: 'external', type: 'pong', ok: true })
    }
    const list = await log.list()
    expect(list).toHaveLength(MAX_LOG_ENTRIES)
    expect(list[0]?.at).toBe(MAX_LOG_ENTRIES + 4)
    expect(list.at(-1)?.at).toBe(5)
  })

  it('빈 저장소에서 list 는 []', async () => {
    expect(await createActivityLog(new FakeStorageArea()).list()).toEqual([])
  })
})
