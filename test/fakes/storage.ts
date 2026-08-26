import type { StorageAreaLike } from '../../src/core/storage-api'

export class FakeStorageArea implements StorageAreaLike {
  public data: Record<string, unknown> = {}

  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.data ? { [key]: structuredClone(this.data[key]) } : {}
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, structuredClone(items))
  }
}
