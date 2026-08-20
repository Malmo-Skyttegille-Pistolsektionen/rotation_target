/**
 * Minimal SSE client over `node:http` — enough to assert what the mock
 * broadcasts. `EventSource` is not a stable global on Node 22, and a real one
 * would reconnect behind the test's back.
 */
import http from 'http';

export interface SSEFrame {
  event: string;
  data: string;
}

export interface SSEReader {
  frames: SSEFrame[];
  /** Frames of one type, parsed as JSON. */
  payloads<T>(event: string): T[];
  close(): void;
}

export function openSSE(port: number, path = '/sse/v2'): Promise<SSEReader> {
  return new Promise((resolve, reject) => {
    const frames: SSEFrame[] = [];
    let buffer = '';

    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let split: number;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);

          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event !== undefined && data !== undefined) frames.push({ event, data });
        }
      });

      resolve({
        frames,
        payloads<T>(event: string): T[] {
          return frames.filter((f) => f.event === event).map((f) => JSON.parse(f.data) as T);
        },
        close: () => req.destroy(),
      });
    });

    req.on('error', reject);
  });
}

/** Let the server's writes reach the socket before asserting on them. */
export function flushIO(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
