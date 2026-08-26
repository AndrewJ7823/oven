import type { ActivityEntry } from './activity-log'
import type { TransportState } from '../transports/websocket'

/** 팝업/뱃지에 표시할 WebSocket 연결 상태 (FR-13) */
export type ConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'error'

export function toConnectionStatus(enabled: boolean, transportState: TransportState): ConnectionStatus {
  if (!enabled) return 'disabled'
  switch (transportState) {
    case 'open':
      return 'connected'
    case 'connecting':
      return 'connecting'
    default:
      return 'error' // 활성인데 idle/closed → 접속 실패 상태
  }
}

export interface StatusView {
  label: string
  dot: 'green' | 'amber' | 'red' | 'grey'
}

export function describeStatus(status: ConnectionStatus): StatusView {
  switch (status) {
    case 'connected':
      return { label: '연결됨', dot: 'green' }
    case 'connecting':
      return { label: '연결 중…', dot: 'amber' }
    case 'error':
      return { label: '연결 끊김', dot: 'red' }
    case 'disabled':
      return { label: '비활성', dot: 'grey' }
  }
}

export interface BadgeView {
  text: string
  color: string
}

/** 툴바 아이콘 뱃지: 정상/비활성은 표시 없음, 주의가 필요할 때만 텍스트 표시 */
export function describeBadge(status: ConnectionStatus): BadgeView {
  switch (status) {
    case 'connected':
      return { text: '', color: '#2e7d32' }
    case 'disabled':
      return { text: '', color: '#9e9e9e' }
    case 'connecting':
      return { text: '…', color: '#d19a00' }
    case 'error':
      return { text: '!', color: '#c62828' }
  }
}

/** 팝업에 보여줄 마지막 처리 1건 요약 (쿠키 값 미포함) */
export function summarizeLast(entry?: ActivityEntry): string {
  if (!entry) return '처리 기록 없음'
  if (entry.errorCode) return `${entry.type ?? '요청'} · ${entry.errorCode}`
  const result = entry.ok ? 'OK' : '실패'
  if (entry.type === 'cookies.replace') return `cookies.replace · ${result} · applied ${entry.applied ?? 0}`
  return `${entry.type ?? '요청'} · ${result}`
}
