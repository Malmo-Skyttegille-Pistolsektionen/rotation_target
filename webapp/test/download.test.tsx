// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { datedFilename, downloadJson, programFilename } from '../src/lib/download';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saving a program as a file', () => {
  it('names the file the way resources/programs/files/ needs it', () => {
    // Promotion is "download, drop in, commit". A name that has to be
    // corrected first is a step to get wrong.
    expect(programFilename(42)).toBe('42.json');
  });

  it('hands the browser the text under that name', () => {
    const created: string[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => {
        created.push('blob:x');
        return 'blob:x';
      },
      revokeObjectURL: () => undefined,
    });

    const clicked: HTMLAnchorElement[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this);
    };

    try {
      downloadJson('42.json', '{"id":42}');
      expect(clicked).toHaveLength(1);
      expect(clicked[0].download).toBe('42.json');
      expect(clicked[0].href).toContain('blob:x');
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  it('leaves no anchor behind in the document', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => undefined;

    try {
      downloadJson('42.json', '{}');
      expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });
});

describe('naming a file the device could not date', () => {
  // The device has no clock and never learns one, so its half of the name has
  // no date in it. This is the half only the browser knows.
  const noon = new Date(2026, 7, 25, 12, 0, 0);

  it('inserts the date before the extension, not after it', () => {
    expect(datedFilename('rotation-target-2.0.0-task_watchdog.zip', noon)).toBe(
      'rotation-target-2.0.0-task_watchdog-2026-08-25.zip',
    );
  });

  it('uses the local date, which is the one the person reading it is in', () => {
    // 00:30 local on the 25th is still the 24th in UTC. A UTC stamp would
    // date a bundle to the day before the crash it describes.
    expect(datedFilename('bundle.zip', new Date(2026, 7, 25, 0, 30, 0))).toBe('bundle-2026-08-25.zip');
  });

  it('appends when there is no extension to insert before', () => {
    expect(datedFilename('bundle', noon)).toBe('bundle-2026-08-25');
  });

  it('leaves a dotfile alone rather than treating the whole name as an extension', () => {
    expect(datedFilename('.bundle', noon)).toBe('.bundle-2026-08-25');
  });
});
