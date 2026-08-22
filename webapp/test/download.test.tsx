// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadJson, programFilename } from '../src/lib/download';

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
