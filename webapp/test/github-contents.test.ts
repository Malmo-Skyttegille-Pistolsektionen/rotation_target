import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiError, fetchRepoProgramFile, idFromFilename, listRepoProgramFiles } from '../src/lib/github-contents';

describe('idFromFilename', () => {
  it('reads the id out of a program filename', () => {
    expect(idFromFilename('42.json')).toBe(42);
    expect(idFromFilename('1000.json')).toBe(1000);
  });

  it('is null for anything not shaped like <digits>.json', () => {
    expect(idFromFilename('readme.md')).toBeNull();
    expect(idFromFilename('42.json.bak')).toBeNull();
    expect(idFromFilename('audios.json')).toBeNull();
  });
});

describe('listRepoProgramFiles', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps only .json files, sorted by the id in their name', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: '20.json', path: 'resources/programs/files/20.json', type: 'file', download_url: 'https://raw/20' },
          { name: '2.json', path: 'resources/programs/files/2.json', type: 'file', download_url: 'https://raw/2' },
          {
            name: 'README.md',
            path: 'resources/programs/files/README.md',
            type: 'file',
            download_url: 'https://raw/r',
          },
          { name: 'sub', path: 'resources/programs/files/sub', type: 'dir', download_url: null },
        ]),
        { status: 200 },
      ),
    );

    const files = await listRepoProgramFiles({ owner: 'acme', repo: 'rotation_target' });

    expect(files.map((f) => f.name)).toEqual(['2.json', '20.json']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/rotation_target/contents/resources/programs/files',
      expect.anything(),
    );
  });

  it('raises a plain error for a repo that does not exist', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(listRepoProgramFiles({ owner: 'acme', repo: 'nope' })).rejects.toThrow(GitHubApiError);
  });

  it('names rate limiting specifically, since unauthenticated requests are capped at 60/hour', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }));
    await expect(listRepoProgramFiles({ owner: 'acme', repo: 'rotation_target' })).rejects.toThrow(/rate limit/i);
  });
});

describe('fetchRepoProgramFile', () => {
  it('returns the raw text at the download URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"title":"x"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const text = await fetchRepoProgramFile({
      name: '42.json',
      path: 'resources/programs/files/42.json',
      downloadUrl: 'https://raw.githubusercontent.com/acme/rotation_target/main/resources/programs/files/42.json',
    });

    expect(text).toBe('{"title":"x"}');
    vi.unstubAllGlobals();
  });
});
