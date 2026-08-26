import type { NavigatorApi, OpenedTab } from '../../src/core/navigator-api'

/** 창 열기/새로고침을 기록하는 페이크. 호출 순서 검증에 사용한다. */
export class FakeNavigator implements NavigatorApi {
  opened: { url: string; focused: boolean }[] = []
  reloaded: number[] = []
  /** openWindow → reloadTab 순서 확인용 이벤트 로그 */
  events: string[] = []
  private nextTabId: number | null
  openError: Error | null = null
  reloadError: Error | null = null

  constructor(nextTabId: number | null = 1) {
    this.nextTabId = nextTabId
  }

  async openWindow(url: string, focused: boolean): Promise<OpenedTab> {
    this.events.push(`open:${url}`)
    if (this.openError) throw this.openError
    this.opened.push({ url, focused })
    return { tabId: this.nextTabId }
  }

  async reloadTab(tabId: number): Promise<void> {
    this.events.push(`reload:${tabId}`)
    if (this.reloadError) throw this.reloadError
    this.reloaded.push(tabId)
  }
}
