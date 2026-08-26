import type { Handler } from '../core/handler'
import { errorResponse } from '../core/protocol'

export interface ExternalSender {
  origin?: string
  url?: string
  id?: string
}

/** chrome.runtime.onMessageExternal 과 호환되는 최소 이벤트 인터페이스 */
export interface ExternalMessageEvent {
  addListener(
    cb: (message: unknown, sender: ExternalSender, sendResponse: (response: unknown) => void) => boolean | void,
  ): void
}

const requestIdOf = (m: unknown): string | null =>
  typeof m === 'object' && m !== null && typeof (m as { requestId?: unknown }).requestId === 'string'
    ? (m as { requestId: string }).requestId
    : null

/** FR-01: externally_connectable 오리진에서 온 sendMessage 를 핸들러로 연결한다. */
export function attachExternalMessageTransport(event: ExternalMessageEvent, handle: Handler): void {
  event.addListener((message, sender, sendResponse) => {
    handle(message, { transport: 'external', origin: sender.origin })
      .then(sendResponse)
      .catch(() => sendResponse(errorResponse('E_INTERNAL', 'internal error', { requestId: requestIdOf(message) })))
    return true // 비동기 sendResponse 유지
  })
}
