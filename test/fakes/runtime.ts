import type { ExternalMessageEvent, ExternalSender } from '../../src/transports/external-message'

type Listener = Parameters<ExternalMessageEvent['addListener']>[0]

/** chrome.runtime.onMessageExternal 페이크. dispatch() 로 외부 앱의 sendMessage 를 흉내낸다. */
export class FakeExternalMessageEvent implements ExternalMessageEvent {
  private listeners: Listener[] = []

  addListener(cb: Listener): void {
    this.listeners.push(cb)
  }

  get listenerCount(): number {
    return this.listeners.length
  }

  dispatch(message: unknown, sender: ExternalSender = { origin: 'http://localhost:3000' }): Promise<unknown> {
    return new Promise((resolve) => {
      let async = false
      for (const l of this.listeners) {
        const ret = l(message, sender, (r) => resolve(r))
        if (ret === true) async = true
      }
      if (!async) resolve(undefined)
    })
  }
}
