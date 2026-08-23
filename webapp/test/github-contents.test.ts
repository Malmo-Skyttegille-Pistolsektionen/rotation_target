import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubApiError,
  fetchRepoAudioCatalogue,
  fetchRepoProgramFile,
  idFromFilename,
  listRepoProgramFiles,
} from '../src/lib/github-contents';

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

/**
 * Without this the Pages editor has no clip names at all - every clip on an
 * event renders as a bare id, because there is no device to ask.
 */
describe('fetchRepoAudioCatalogue', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function serving(body: unknown): void {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }

  // audios.json is a map keyed by id, and the values carry no `id` of their
  // own - the key is it.
  it('turns the id-keyed map into AudioFiles, sorted by id', async () => {
    serving({
      '28': { title: '10 sekunder', phrase: '10 sekunder', filename: '28.wav' },
      '1': { title: '1', phrase: '1', filename: '1.wav' },
    });

    expect(await fetchRepoAudioCatalogue({ owner: 'o', repo: 'r' })).toEqual([
      { id: 1, title: '1', filename: '1.wav', readonly: true },
      { id: 28, title: '10 sekunder', filename: '28.wav', readonly: true },
    ]);
  });

  // Everything in the repository is shipped by definition; an uploaded clip
  // exists only on a device, so nothing here can be anything else.
  it('marks every entry read-only', async () => {
    serving({ '5': { title: '5', filename: '5.wav' } });
    const [clip] = await fetchRepoAudioCatalogue({ owner: 'o', repo: 'r' });
    expect(clip.readonly).toBe(true);
  });

  it('skips entries whose key is not an id, rather than failing the whole list', async () => {
    serving({ '7': { title: 'Sju', filename: '7.wav' }, notAnId: { title: 'x', filename: 'x.wav' } });
    expect(await fetchRepoAudioCatalogue({ owner: 'o', repo: 'r' })).toEqual([
      { id: 7, title: 'Sju', filename: '7.wav', readonly: true },
    ]);
  });

  it('reads the default branch unless a ref is given', async () => {
    serving({});
    await fetchRepoAudioCatalogue({ owner: 'o', repo: 'r' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://raw.githubusercontent.com/o/r/main/resources/audios/audios.json');

    await fetchRepoAudioCatalogue({ owner: 'o', repo: 'r', ref: 'some-branch' });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://raw.githubusercontent.com/o/r/some-branch/resources/audios/audios.json',
    );
  });

  it('raises rather than returning a half-list when the file is missing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    await expect(fetchRepoAudioCatalogue({ owner: 'o', repo: 'r' })).rejects.toBeInstanceOf(GitHubApiError);
  });

  // A JSON array, or a string, is not the shape this file has - treat it as
  // "no catalogue" rather than throwing, since the editor works without one.
  it('is empty for a document that is not an object', async () => {
    serving([1, 2, 3]);
    expect(await fetchRepoAudioCatalogue({ owner: 'o', repo: 'r' })).toEqual([]);
  });
});
