/**
 * A hand-driven stand-in for `EventSource`. The real one owns its own
 * reconnect timer and network, neither of which a unit test can steer; this
 * one lets a test say exactly which frame arrives when, and records whether
 * the hook actually closed the stream it replaced.
 */
type Listener = (event: MessageEvent) => void;

export class FakeEventSource {
  static instances: FakeEventSource[] = [];

  static reset(): void {
    FakeEventSource.instances = [];
  }

  static get latest(): FakeEventSource {
    // Not `.at(-1)`: the app's tsconfig targets ES2020.
    const last = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!last) throw new Error('no EventSource was constructed');
    return last;
  }

  readonly url: string;
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  // --- test-side drivers ---

  open(): void {
    this.onopen?.(new Event('open'));
  }

  error(): void {
    this.onerror?.(new Event('error'));
  }

  /** Deliver a named SSE frame. Returns false if nothing is listening for it. */
  emit(type: string, data: unknown): boolean {
    const set = this.listeners.get(type);
    const payload = { data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent;
    set?.forEach((listener) => listener(payload));
    return set !== undefined && set.size > 0;
  }
}
