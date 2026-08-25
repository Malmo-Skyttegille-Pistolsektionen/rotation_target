/**
 * Opening a program from a GitHub repo, for the Pages editor (#140).
 *
 * The contents API is CORS-enabled and unauthenticated for a public repo, so
 * this needs no token — the same reason the pull-request-back path can do
 * without one. Unauthenticated requests are rate-limited per IP (60/hour);
 * `githubJson` surfaces a 403 distinctly so the caller can say so rather than
 * report a generic failure.
 */
import type { AudioFile } from '../api/types';
import { PROGRAMS_PATH } from './pr-url';

/** Where the shipped audio catalogue lives in the repository. */
const AUDIOS_PATH = 'resources/audios/audios.json';

export interface RepoLocation {
  owner: string;
  repo: string;
  /** Branch, tag or commit SHA. Omitted means the repo's default branch. */
  ref?: string;
  /**
   * Directory to list. Omitted means this repository's own layout
   * (`resources/programs/files`), which is a fact about *us* and only a guess
   * about anybody else - a wrong guess reads as "the repo is empty" rather
   * than "the path is wrong", which is what #221 is about.
   */
  path?: string;
}

export interface RepoProgramFile {
  /** e.g. `42.json` */
  name: string;
  /** e.g. `resources/programs/files/42.json` */
  path: string;
  downloadUrl: string;
}

interface ContentsApiEntry {
  name: string;
  path: string;
  type: string;
  download_url: string | null;
}

export class GitHubApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) {
    const rateLimited = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
    throw new GitHubApiError(
      response.status,
      rateLimited
        ? 'GitHub API rate limit reached for unauthenticated requests — try again in a few minutes.'
        : `GitHub returned ${String(response.status)} for ${url}.`,
    );
  }
  return (await response.json()) as T;
}

/** The id a program filename declares — `42.json` → `42` — or `null` when it is not shaped that way. */
export function idFromFilename(name: string): number | null {
  const match = /^(\d+)\.json$/.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Lists the program files in a repo directory, sorted by id. **One** API
 * request, whatever the directory holds.
 *
 * Filtered on `idFromFilename`, not on `.json`. It used to be the latter, so a
 * stray `notes.json` was listed and sorted to the front as id 0. Harmless while
 * the path was hardcoded to our own layout; once the caller can point this at
 * any directory (#221), "every .json here is a program" stops being a
 * reasonable assumption at all.
 */
export async function listRepoProgramFiles(location: RepoLocation): Promise<RepoProgramFile[]> {
  const path = (location.path ?? PROGRAMS_PATH).replace(/^\/+|\/+$/g, '');
  const refQuery = location.ref ? `?ref=${encodeURIComponent(location.ref)}` : '';
  const url = `https://api.github.com/repos/${location.owner}/${location.repo}/contents/${path}${refQuery}`;
  const entries = await githubJson<ContentsApiEntry[]>(url);
  return entries
    .filter(
      (entry): entry is ContentsApiEntry & { download_url: string } =>
        entry.type === 'file' && idFromFilename(entry.name) !== null && entry.download_url !== null,
    )
    .map((entry) => ({ name: entry.name, path: entry.path, downloadUrl: entry.download_url }))
    .sort((a, b) => (idFromFilename(a.name) ?? 0) - (idFromFilename(b.name) ?? 0));
}

/** What a listed file says about itself, once its contents have been read. */
export interface RepoProgramSummary {
  /** The id the *document* declares, which need not be the one the filename claims. */
  declaredId: number | null;
  title: string | null;
}

/**
 * The title inside one listed file, so a list can say "Provserie" rather than
 * `42.json`.
 *
 * **This does not spend API quota.** The contents API hands back a
 * `download_url` on `raw.githubusercontent.com`, which is not the API and
 * carries no `x-ratelimit-*` headers - measured, not assumed. #221 worried that
 * showing titles would take a 12-program listing from 1 request to 13 and put a
 * club at a range over the 60/hour limit; that is not what happens. The listing
 * is one API request either way, and the titles ride on raw.
 *
 * Deliberately lenient: this is decoration on a list, so a file that will not
 * parse gets `null` and keeps its filename rather than failing the browse. The
 * real validation happens when the document is actually opened.
 */
export async function fetchRepoProgramSummary(
  file: RepoProgramFile,
  signal?: AbortSignal,
): Promise<RepoProgramSummary> {
  const empty: RepoProgramSummary = { declaredId: null, title: null };
  try {
    const response = await fetch(file.downloadUrl, signal ? { signal } : {});
    if (!response.ok) return empty;
    const raw: unknown = await response.json();
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return empty;
    const doc = raw as Record<string, unknown>;
    return {
      declaredId: typeof doc.id === 'number' && Number.isInteger(doc.id) ? doc.id : null,
      title: typeof doc.title === 'string' && doc.title.trim() !== '' ? doc.title : null,
    };
  } catch {
    // Includes the abort when the user browses somewhere else mid-flight.
    return empty;
  }
}

/** Fetches one program file's raw text — from `raw.githubusercontent.com`, also CORS-enabled. */
export async function fetchRepoProgramFile(file: RepoProgramFile): Promise<string> {
  const response = await fetch(file.downloadUrl);
  if (!response.ok) {
    throw new GitHubApiError(response.status, `GitHub returned ${String(response.status)} fetching ${file.path}.`);
  }
  return response.text();
}

/**
 * The shipped audio catalogue from a repo, as the editor's `AudioFile[]`.
 *
 * The Pages editor has no device, so it has no `GET /audios` to ask - and
 * without one every clip on an event renders as its bare id. The repository is
 * the same catalogue the device is flashed with, and `raw.githubusercontent.com`
 * serves it CORS-enabled, so a clip can be named without a board.
 *
 * `audios.json` is a map keyed by id, whose values carry `title` and
 * `filename` but no `id` - the key is the id. `readonly` is true for all of
 * them: everything in the repository is shipped by definition, and an uploaded
 * clip only exists on a device.
 */
export async function fetchRepoAudioCatalogue(location: RepoLocation): Promise<AudioFile[]> {
  const ref = location.ref ?? 'main';
  const url = `https://raw.githubusercontent.com/${location.owner}/${location.repo}/${ref}/${AUDIOS_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new GitHubApiError(response.status, `GitHub returned ${String(response.status)} fetching ${AUDIOS_PATH}.`);
  }
  const raw: unknown = await response.json();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];

  return Object.entries(raw as Record<string, unknown>)
    .flatMap(([key, value]) => {
      const id = Number(key);
      if (!Number.isInteger(id) || typeof value !== 'object' || value === null) return [];
      const entry = value as Record<string, unknown>;
      const title = typeof entry.title === 'string' ? entry.title : String(id);
      const filename = typeof entry.filename === 'string' ? entry.filename : `${String(id)}.wav`;
      return [{ id, title, filename, readonly: true }];
    })
    .sort((a, b) => a.id - b.id);
}
