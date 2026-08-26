/**
 * 창/탭 조작 인터페이스. chrome.windows / chrome.tabs 를 얇게 감싸 코어에 주입한다. (NFR-02)
 * openWindow: 주소로 새 창을 열고 그 안의 탭 id 를 돌려준다.
 * reloadTab: 탭을 강제 새로고침(캐시 무시)한다.
 */
export interface OpenedTab {
  tabId: number | null
}

export interface NavigatorApi {
  openWindow(url: string, focused: boolean): Promise<OpenedTab>
  reloadTab(tabId: number): Promise<void>
}
