import { describe, it, expect } from 'vitest'
import { toConnectionStatus, describeStatus, describeBadge, summarizeLast } from '../../src/core/status'
import type { ActivityEntry } from '../../src/core/activity-log'

describe('FR-13 연결 상태 판정', () => {
  it('WebSocket 비활성이면 항상 disabled', () => {
    expect(toConnectionStatus(false, 'open')).toBe('disabled')
    expect(toConnectionStatus(false, 'idle')).toBe('disabled')
  })
  it('활성 + 트랜스포트 상태 매핑', () => {
    expect(toConnectionStatus(true, 'open')).toBe('connected')
    expect(toConnectionStatus(true, 'connecting')).toBe('connecting')
    expect(toConnectionStatus(true, 'closed')).toBe('error')
    expect(toConnectionStatus(true, 'idle')).toBe('error')
  })
})

describe('FR-13 상태 표시(팝업 점 + 라벨)', () => {
  it('각 상태의 라벨과 점 색', () => {
    expect(describeStatus('connected')).toEqual({ label: '연결됨', dot: 'green' })
    expect(describeStatus('connecting')).toEqual({ label: '연결 중…', dot: 'amber' })
    expect(describeStatus('error')).toEqual({ label: '연결 끊김', dot: 'red' })
    expect(describeStatus('disabled')).toEqual({ label: '비활성', dot: 'grey' })
  })
})

describe('FR-13 툴바 아이콘 뱃지', () => {
  it('연결됨/비활성은 뱃지 없음, 연결 중은 …(amber), 끊김은 !(red)', () => {
    expect(describeBadge('connected')).toEqual({ text: '', color: '#2e7d32' })
    expect(describeBadge('disabled')).toEqual({ text: '', color: '#9e9e9e' })
    expect(describeBadge('connecting')).toEqual({ text: '…', color: '#d19a00' })
    expect(describeBadge('error')).toEqual({ text: '!', color: '#c62828' })
  })
})

describe('FR-13 마지막 활동 요약', () => {
  const base: ActivityEntry = { at: 1, transport: 'websocket', type: 'cookies.replace', ok: true }
  it('기록 없으면 안내 문구', () => {
    expect(summarizeLast(undefined)).toBe('처리 기록 없음')
  })
  it('cookies.replace 성공', () => {
    expect(summarizeLast({ ...base, applied: 2, removed: 1, failedCount: 0 })).toBe('cookies.replace · OK · applied 2')
  })
  it('오류 코드가 있으면 코드 표시', () => {
    expect(summarizeLast({ at: 1, transport: 'external', type: null, ok: false, errorCode: 'E_UNAUTHORIZED' })).toBe('요청 · E_UNAUTHORIZED')
  })
  it('pong', () => {
    expect(summarizeLast({ at: 1, transport: 'external', type: 'pong', ok: true })).toBe('pong · OK')
  })
  it('cookies.replace 부분 실패', () => {
    expect(summarizeLast({ ...base, ok: false, applied: 1, removed: 0, failedCount: 1 })).toBe('cookies.replace · 실패 · applied 1')
  })
})
