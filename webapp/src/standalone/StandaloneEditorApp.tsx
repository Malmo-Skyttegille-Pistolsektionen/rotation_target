import { useEffect, useRef, useState } from 'react';
import { ExportPanel } from '../components/ExportPanel';
import { ProgramEditor, type EditorTarget } from '../components/ProgramEditor';
import {
  GitHubApiError,
  fetchRepoProgramFile,
  fetchRepoProgramSummary,
  idFromFilename,
  listRepoProgramFiles,
  type RepoProgramFile,
  type RepoProgramSummary,
} from '../lib/github-contents';
import { PROGRAMS_PATH } from '../lib/pr-url';
import { fetchRepoAudioCatalogue } from '../lib/github-contents';
import { parseProgramDocument } from '../lib/program-document';
import styles from './StandaloneEditorApp.module.css';

const CANONICAL_OWNER = 'Malmo-Skyttegille-Pistolsektionen';
const CANONICAL_REPO = 'rotation_target';

/** A document picked but not yet handed to the editor — it still needs an id confirmed. */
interface Opened {
  /** Raw file text, or `null` for a brand-new, empty document. */
  text: string | null;
  /** One line of "where this came from", carried into the pull request body. */
  origin: string;
  /** The id the source suggested — a filename or a `declaredId` in the JSON — if any. */
  suggestedId: number | null;
}

/**
 * The Pages build's whole page (#140): no device, so there is no program list
 * to open from and nothing to save to. This picks a document — from this
 * repo, another repo, a local file, or empty — confirms an id, then hands
 * both to the same `ProgramEditor` the device build uses.
 */
export function StandaloneEditorApp(): React.ReactNode {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [target, setTarget] = useState<EditorTarget | null>(null);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Rotation Target — Program Editor</h1>
        <p className={styles.hint}>
          Runs entirely in this browser tab, with no device attached. Open a program, edit it, then download it or send
          it back as a pull request.
        </p>
      </header>

      {target ? (
        <ProgramEditor
          target={target}
          onClose={() => {
            setTarget(null);
            setOpened(null);
          }}
          onCreated={() => {
            // Unreachable for a `standalone` target — there is no device `POST` to succeed.
          }}
          renderExport={(props) => <ExportPanel {...props} />}
          // The canonical repo's catalogue, not the one a program was opened
          // from: clip ids are the shipped set's, and a fork's copy of
          // audios.json is the same file until somebody changes it.
          loadAudios={() => fetchRepoAudioCatalogue({ owner: CANONICAL_OWNER, repo: CANONICAL_REPO })}
        />
      ) : opened ? (
        <ConfirmOpen
          opened={opened}
          onCancel={() => setOpened(null)}
          onConfirm={(confirmedTarget) => setTarget(confirmedTarget)}
        />
      ) : (
        <Picker onOpened={setOpened} />
      )}
    </main>
  );
}

// --- Picking a document ---

interface PickerProps {
  onOpened: (opened: Opened) => void;
}

function Picker({ onOpened }: PickerProps): React.ReactNode {
  return (
    <div className={styles.picker}>
      <RepoBrowser onOpened={onOpened} />
      <LocalFileOpener onOpened={onOpened} />
      <NewDocument onOpened={onOpened} />
    </div>
  );
}

/**
 * How many title fetches are in flight at once.
 *
 * They do not spend API quota - the contents listing hands back
 * `raw.githubusercontent.com` URLs, which are not the API (see
 * `fetchRepoProgramSummary`) - but firing two hundred at a repository with two
 * hundred programs is rude regardless, and the first few rows are the ones
 * anybody is looking at.
 */
const TITLE_FETCH_CONCURRENCY = 4;

/**
 * One card for every repository, including ours (#221).
 *
 * There used to be two - "this repo" and "another repo" - differing only in
 * whether the owner and repo inputs were shown. Once the path and ref are
 * fields as well, "this repo" is just a set of defaults, and two cards asked
 * the user to decide which one applied before they had any reason to care.
 * Somebody browsing our programs presses Browse and touches nothing.
 *
 * Titles arrive lazily. The list is usable the moment the single API request
 * returns, each row upgrades from `42.json` to its title as that file lands,
 * and a file that will not parse simply keeps its filename. Nothing waits on
 * anything.
 */
function RepoBrowser({ onOpened }: PickerProps): React.ReactNode {
  const [owner, setOwner] = useState(CANONICAL_OWNER);
  const [repo, setRepo] = useState(CANONICAL_REPO);
  const [path, setPath] = useState(PROGRAMS_PATH);
  const [ref, setRef] = useState('');
  const [files, setFiles] = useState<RepoProgramFile[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, RepoProgramSummary>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Abandons the title fetches from a previous browse. Without it, a slow
  // response from the repository somebody has just navigated away from writes
  // its titles into the list they are now looking at.
  const titleFetchRef = useRef<AbortController | null>(null);
  useEffect(() => () => titleFetchRef.current?.abort(), []);

  function loadTitles(found: RepoProgramFile[]): void {
    titleFetchRef.current?.abort();
    const controller = new AbortController();
    titleFetchRef.current = controller;

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < found.length && !controller.signal.aborted) {
        const file = found[next++];
        const summary = await fetchRepoProgramSummary(file, controller.signal);
        if (controller.signal.aborted) return;
        // Only when there is something to show: an empty summary would
        // re-render every row for nothing.
        if (summary.title !== null || summary.declaredId !== null) {
          setSummaries((current) => ({ ...current, [file.path]: summary }));
        }
      }
    };
    for (let i = 0; i < TITLE_FETCH_CONCURRENCY; i++) void worker();
  }

  async function browse(): Promise<void> {
    if (owner.trim() === '' || repo.trim() === '') return;
    setBusy(true);
    setError(null);
    setFiles(null);
    setSummaries({});
    try {
      const found = await listRepoProgramFiles({
        owner: owner.trim(),
        repo: repo.trim(),
        path: path.trim() === '' ? undefined : path.trim(),
        ref: ref.trim() === '' ? undefined : ref.trim(),
      });
      setFiles(found);
      loadTitles(found);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function open(file: RepoProgramFile): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const text = await fetchRepoProgramFile(file);
      onOpened({ text, origin: repoOrigin(owner, repo, ref, file), suggestedId: idFromFilename(file.name) });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} data-testid='picker-repo'>
      <h2 className={styles.cardTitle}>Open from repo</h2>
      <p className={styles.hint}>
        Pre-filled with this project&rsquo;s own repository — press Browse to see its programs, or point the fields at
        another club&rsquo;s.
      </p>
      <div className={styles.repoRow}>
        <label className={styles.field}>
          <span>Owner</span>
          <input
            className={styles.input}
            value={owner}
            placeholder='owner'
            data-testid='picker-repo-owner'
            onChange={(event) => setOwner(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Repo</span>
          <input
            className={styles.input}
            value={repo}
            placeholder='repo'
            data-testid='picker-repo-repo'
            onChange={(event) => setRepo(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.repoRow}>
        <label className={styles.field}>
          <span>Path</span>
          <input
            className={styles.input}
            value={path}
            placeholder={PROGRAMS_PATH}
            data-testid='picker-repo-path'
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Ref</span>
          <input
            className={styles.input}
            value={ref}
            placeholder='branch, tag or commit — blank for the default branch'
            data-testid='picker-repo-ref'
            onChange={(event) => setRef(event.target.value)}
          />
        </label>
      </div>
      <button
        className={styles.button}
        disabled={busy || owner.trim() === '' || repo.trim() === ''}
        data-testid='picker-repo-browse'
        onClick={() => void browse()}
      >
        {busy && files === null ? 'Loading…' : 'Browse programs'}
      </button>
      {error && (
        <p className={styles.error} data-testid='picker-repo-error'>
          {error}
        </p>
      )}
      {files && (
        <ul className={styles.fileList} data-testid='picker-repo-files'>
          {files.length === 0 && <li className={styles.hint}>No program files found at that path.</li>}
          {files.map((file) => (
            <li key={file.path}>
              <button
                className={styles.fileButton}
                disabled={busy}
                data-testid={`picker-repo-file-${file.name}`}
                onClick={() => void open(file)}
              >
                {fileLabel(file, summaries[file.path])}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What a row says. The filename until its title arrives, then the same shape
 * the device's Programs page uses - id first, because that is what a program
 * is addressed by.
 *
 * The id shown is the *filename's*, not the document's: the filename is the
 * authority on the id everywhere else in this system (the firmware says so
 * explicitly), and a document declaring a different one is a discrepancy worth
 * seeing rather than hiding.
 */
function fileLabel(file: RepoProgramFile, summary: RepoProgramSummary | undefined): string {
  const id = idFromFilename(file.name);
  if (!summary?.title) return file.name;
  const label = id === null ? summary.title : `${String(id)} — ${summary.title}`;
  return summary.declaredId !== null && summary.declaredId !== id
    ? `${label} (document says id ${String(summary.declaredId)})`
    : label;
}

/** The "where this came from" line carried into the pull request body, naming the ref when there is one. */
function repoOrigin(owner: string, repo: string, ref: string, file: RepoProgramFile): string {
  const at = ref.trim() === '' ? '' : `@${ref.trim()}`;
  return `${owner.trim()}/${repo.trim()}${at}/${file.path}`;
}

function LocalFileOpener({ onOpened }: PickerProps): React.ReactNode {
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      onOpened({ text, origin: `local file "${file.name}"`, suggestedId: idFromFilename(file.name) });
    } catch {
      setError('Could not read that file.');
    }
  }

  return (
    <section className={styles.card} data-testid='picker-file'>
      <h2 className={styles.cardTitle}>Open a local file</h2>
      <input
        className={styles.input}
        type='file'
        accept='application/json,.json'
        data-testid='picker-file-input'
        onChange={(event) => void handleChange(event)}
      />
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}

function NewDocument({ onOpened }: PickerProps): React.ReactNode {
  return (
    <section className={styles.card} data-testid='picker-new'>
      <h2 className={styles.cardTitle}>Start a new program</h2>
      <button
        className={styles.button}
        data-testid='picker-new-start'
        onClick={() => onOpened({ text: null, origin: 'new, not opened from anywhere', suggestedId: null })}
      >
        New program
      </button>
    </section>
  );
}

function describeError(err: unknown): string {
  if (err instanceof GitHubApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

// --- Confirming the id before the editor opens ---

interface ConfirmOpenProps {
  opened: Opened;
  onCancel: () => void;
  onConfirm: (target: EditorTarget) => void;
}

/**
 * There is no device to assign an id here, so the author does (#140, "worth
 * deciding" in the issue): this is the one screen that asks for it, before
 * the editor — which never offers an id field of its own — opens.
 */
function ConfirmOpen({ opened, onCancel, onConfirm }: ConfirmOpenProps): React.ReactNode {
  const parsed = opened.text === null ? null : parseProgramDocument(opened.text);
  const [idText, setIdText] = useState(opened.suggestedId !== null ? String(opened.suggestedId) : '');

  if (parsed && !parsed.ok) {
    return (
      <section className={styles.card} data-testid='picker-confirm-invalid'>
        <h2 className={styles.cardTitle}>This is not a program the editor can open</h2>
        <p className={styles.hint}>{opened.origin}:</p>
        <ul className={styles.issues}>
          {parsed.errors.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              <code>{issue.path || '/'}</code> — {issue.message}
            </li>
          ))}
        </ul>
        <button className={styles.button} onClick={onCancel}>
          Back
        </button>
      </section>
    );
  }

  const id = Number(idText);
  const validId = idText.trim() !== '' && Number.isInteger(id) && id >= 0;

  return (
    <section className={styles.card} data-testid='picker-confirm'>
      <h2 className={styles.cardTitle}>Open {opened.origin}</h2>
      <label className={styles.field}>
        <span>Program id</span>
        <input
          className={styles.input}
          inputMode='numeric'
          value={idText}
          data-testid='picker-confirm-id'
          onChange={(event) => setIdText(event.target.value)}
        />
      </label>
      <p className={styles.hint}>
        Used as the filename in a pull request — <code>resources/programs/files/{idText || '<id>'}.json</code>. Shipped
        programs keep ids below 1000 (uploads start there; see
        <code> resources/programs/validate_programs.sh</code>).
      </p>
      <div className={styles.buttonRow}>
        <button className={styles.button} data-testid='picker-confirm-back' onClick={onCancel}>
          Back
        </button>
        <button
          className={styles.buttonPrimary}
          disabled={!validId}
          data-testid='picker-confirm-open'
          onClick={() =>
            onConfirm({
              kind: 'standalone',
              id,
              document: parsed && parsed.ok ? parsed.program : null,
              origin: opened.origin,
            })
          }
        >
          Open in editor
        </button>
      </div>
    </section>
  );
}
