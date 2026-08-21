/**
 * What the programs tab and the editor say when a call to the device fails.
 *
 * Shared because both of them make the same three writes — create, replace,
 * load — and the refusals that need explaining are the same refusals. The
 * `PUT` 409 in particular is a paragraph of context (D-15) that must not exist
 * in two versions that can drift apart.
 */
import { ApiError } from '../api/client';
import type { DocumentIssue } from './program-document';

export interface Notice {
  kind: 'error' | 'success' | 'warning';
  message: string;
  /** One line per point; used for the per-field validation output. */
  details?: string[];
  action?: { label: string; run: () => void };
}

export function issueLines(issues: DocumentIssue[]): string[] {
  return issues.map((issue) => `${issue.path || '/'} — ${issue.message}`);
}

/**
 * Turn a rejected call into something a club member can act on. The device's
 * own message is the fallback, but the ones that need context get it here.
 */
export function failureNotice(err: unknown, prefix: string): Notice {
  if (err instanceof ApiError && err.status === 401) {
    return {
      kind: 'error',
      message: `${prefix} Admin mode is on and this browser is not signed in — sign in under Settings.`,
    };
  }
  return { kind: 'error', message: `${prefix} ${err instanceof Error ? err.message : String(err)}` };
}

export function updateFailureNotice(err: unknown, id: number): Notice {
  if (err instanceof ApiError && err.status === 409) {
    // Shipped is the branch that has to prove itself: the UI never offers
    // Replace on a shipped program, so a 409 that reaches here is the loaded
    // one. Defaulting the other way would answer a reworded message with the
    // wrong explanation entirely.
    if (/read-only|readonly|shipped/i.test(err.message)) {
      return {
        kind: 'error',
        message: `Program ${id} is shipped with the firmware and cannot be replaced. Upload the file as a new program instead.`,
      };
    }
    // D-15: run state holds a pointer into the stored program, so the device
    // refuses. D-22 gave that refusal an escape of its own - before
    // `POST /programs/unload` existed the only ways out were loading some other
    // program or deleting this one, and this notice had to say so.
    return {
      kind: 'error',
      message:
        `Program ${id} is the one currently loaded on the device, and a loaded program cannot be replaced — ` +
        'the run position points into it. Unload it first — the Unload button on the program’s row, or on the ' +
        'Run page — and then replace it. If a series is running, stop it before unloading.',
    };
  }
  if (err instanceof ApiError && err.status === 404) {
    return { kind: 'error', message: `Program ${id} is no longer on the device.` };
  }
  return failureNotice(err, `Could not replace program ${id}.`);
}

/**
 * `POST /programs/unload`. The only refusal it has is a run in progress
 * (D-22): unloading is bookkeeping and must not end a series mid-range, so the
 * device says stop first rather than stopping on the client's behalf. The
 * escape is one button away — Pause on the Run page — which is what this says.
 */
export function unloadFailureNotice(err: unknown): Notice {
  if (err instanceof ApiError && err.status === 409) {
    return {
      kind: 'error',
      message:
        'The device is running a program, and unloading would end the series. Stop the program first (Pause, ' +
        'on the Run page), then unload.',
    };
  }
  return failureNotice(err, 'Could not unload the program.');
}
