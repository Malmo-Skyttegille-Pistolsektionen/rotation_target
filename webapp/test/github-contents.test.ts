import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubApiError,
  fetchRepoAudioCatalogue,
  fetchRepoProgramFile,
  fetchRepoProgramSummary,
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

  it('keeps only files named like a program id, sorted by it', async () => {
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

  // #221: the path was hardcoded to *our* layout, which is a fact about this
  // repository and a guess about anybody else's - and a wrong guess 404s in a
  // way that reads as "the repo is empty" rather than "the path is wrong".
  it('lists the path it is given, and this repo\'s layout when it is given none', async () => {
    // A fresh Response per call: a body can only be read once, and this test
    // lists twice.
    fetchMock.mockImplementation(() => Promise.resolve(new Response('[]', { status: 200 })));

    await listRepoProgramFiles({ owner: 'acme', repo: 'r', path: 'programs' });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/acme/r/contents/programs',
      expect.anything(),
    );

    await listRepoProgramFiles({ owner: 'acme', repo: 'r' });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/acme/r/contents/resources/programs/files',
      expect.anything(),
    );
  });

  // Somebody typing a path will type a slash on one end or the other.
  it('tolerates leading and trailing slashes on the path', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
    await listRepoProgramFiles({ owner: 'acme', repo: 'r', path: '/programs/files/' });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/acme/r/contents/programs/files',
      expect.anything(),
    );
  });

  // The plumbing was already there - RepoLocation.ref and the ?ref= query - and
  // the UI simply never passed one, so you always got the default branch.
  it('asks for a ref when given one', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
    await listRepoProgramFiles({ owner: 'acme', repo: 'r', ref: 'release/2.0' });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/acme/r/contents/resources/programs/files?ref=release%2F2.0',
      expect.anything(),
    );
  });

  // A stray file used to be listed and sorted to the front as id 0. It only
  // mattered a little while the path was ours; it matters once the path is
  // whatever somebody typed.
  it('drops a json file that is not named like a program', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          { name: 'notes.json', path: 'p/notes.json', type: 'file', download_url: 'https://raw/n' },
          { name: 'audios.json', path: 'p/audios.json', type: 'file', download_url: 'https://raw/a' },
          { name: '7.json', path: 'p/7.json', type: 'file', download_url: 'https://raw/7' },
        ]),
        { status: 200 },
      ),
    );
    const files = await listRepoProgramFiles({ owner: 'acme', repo: 'r' });
    expect(files.map((f) => f.name)).toEqual(['7.json']);
  });
});

describe('fetchRepoProgramSummary', () => {
  const fetchMock = vi.fn();
  const file = { name: '42.json', path: 'p/42.json', downloadUrl: 'https://raw/42' };

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the title and the id the document declares', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 42, title: 'Provserie' }), { status: 200 }));
    expect(await fetchRepoProgramSummary(file)).toEqual({ declaredId: 42, title: 'Provserie' });
  });

  // This is decoration on a list. A file that will not parse must cost that
  // one row its title, not the whole browse - the real validation happens when
  // the document is actually opened.
  it('is empty rather than throwing for anything it cannot read', async () => {
    const empty = { declaredId: null, title: null };

    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));
    expect(await fetchRepoProgramSummary(file)).toEqual(empty);

    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
    expect(await fetchRepoProgramSummary(file)).toEqual(empty);

    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    expect(await fetchRepoProgramSummary(file)).toEqual(empty);

    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await fetchRepoProgramSummary(file)).toEqual(empty);
  });

  it('ignores a blank or non-string title', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 42, title: '   ' }), { status: 200 }));
    expect((await fetchRepoProgramSummary(file)).title).toBeNull();

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 42, title: 7 }), { status: 200 }));
    expect((await fetchRepoProgramSummary(file)).title).toBeNull();
  });

  // The listing is one API request whatever the directory holds; the titles
  // ride on raw.githubusercontent.com, which is not the API and does not spend
  // the 60/hour budget. Measured against the real endpoint, and pinned here
  // because the whole lazy-title design rests on it.
  it('reads the raw download URL, not the API', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await fetchRepoProgramSummary(file);
    expect(fetchMock.mock.calls[0][0]).toBe('https://raw/42');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('api.github.com');
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
