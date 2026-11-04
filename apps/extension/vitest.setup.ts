import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

/**
 * Minimal BroadcastChannel polyfill for test environments that do not provide
 * one. Messages are delivered asynchronously to every other open channel with
 * the same name, which matches browser semantics closely enough for the
 * extension's cross-context tests.
 */
if (typeof globalThis.BroadcastChannel === "undefined") {
  type MessageListener = (event: MessageEvent) => void;

  class TestBroadcastChannel extends EventTarget {
    private static readonly channels = new Map<
      string,
      Set<TestBroadcastChannel>
    >();

    readonly name: string;
    onmessage: MessageListener | null = null;
    private closed = false;

    constructor(name: string) {
      super();
      this.name = name;
      const peers = TestBroadcastChannel.channels.get(name) ?? new Set();
      peers.add(this);
      TestBroadcastChannel.channels.set(name, peers);
    }

    postMessage(data: unknown): void {
      if (this.closed) return;
      for (const peer of TestBroadcastChannel.channels.get(this.name) ?? []) {
        if (peer === this || peer.closed) continue;
        queueMicrotask(() => {
          if (peer.closed) return;
          const event = new MessageEvent("message", { data });
          peer.dispatchEvent(event);
          peer.onmessage?.(event);
        });
      }
    }

    close(): void {
      this.closed = true;
      TestBroadcastChannel.channels.get(this.name)?.delete(this);
    }
  }

  Object.defineProperty(globalThis, "BroadcastChannel", {
    value: TestBroadcastChannel,
    configurable: true,
    writable: true,
  });
}
