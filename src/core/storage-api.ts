/** chrome.storage.local / session 과 호환되는 최소 인터페이스 */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}
