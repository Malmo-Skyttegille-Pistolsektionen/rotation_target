import { useState } from 'react';
import { ExportPanel } from '../components/ExportPanel';
import { ProgramEditor, type EditorTarget } from '../components/ProgramEditor';
import {
  GitHubApiError,
  fetchRepoProgramFile,
  idFromFilename,
  listRepoProgramFiles,
  type RepoProgramFile,
} from '../lib/github-contents';
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
      <RepoBrowser
        title='Open from this repo'
        defaultOwner={CANONICAL_OWNER}
        defaultRepo={CANONICAL_REPO}
        fixedRepo
        onOpened={onOpened}
      />
      <RepoBrowser
        title='Open from another repo'
        defaultOwner=''
        defaultRepo=''
        fixedRepo={false}
        onOpened={onOpened}
      />
      <LocalFileOpener onOpened={onOpened} />
      <NewDocument onOpened={onOpened} />
    </div>
  );
}

interface RepoBrowserProps {
  title: string;
  defaultOwner: string;
  defaultRepo: string;
  /** The canonical-repo card skips the owner/repo inputs; the "another repo" one needs them. */
  fixedRepo: boolean;
  onOpened: (opened: Opened) => void;
}

/** Lists `resources/programs/files/` in a repo through the contents API and opens whichever file is picked. */
function RepoBrowser({ title, defaultOwner, defaultRepo, fixedRepo, onOpened }: RepoBrowserProps): React.ReactNode {
  const [owner, setOwner] = useState(defaultOwner);
  const [repo, setRepo] = useState(defaultRepo);
  const [files, setFiles] = useState<RepoProgramFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse(): Promise<void> {
    if (owner.trim() === '' || repo.trim() === '') return;
    setBusy(true);
    setError(null);
    setFiles(null);
    try {
      setFiles(await listRepoProgramFiles({ owner: owner.trim(), repo: repo.trim() }));
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
      onOpened({ text, origin: `${owner.trim()}/${repo.trim()}/${file.path}`, suggestedId: idFromFilename(file.name) });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} data-testid={`picker-repo-${fixedRepo ? 'canonical' : 'other'}`}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {!fixedRepo && (
        <div className={styles.repoRow}>
          <label className={styles.field}>
            <span>Owner</span>
            <input
              className={styles.input}
              value={owner}
              placeholder='owner'
              data-testid='picker-other-owner'
              onChange={(event) => setOwner(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Repo</span>
            <input
              className={styles.input}
              value={repo}
              placeholder='repo'
              data-testid='picker-other-repo'
              onChange={(event) => setRepo(event.target.value)}
            />
          </label>
        </div>
      )}
      <button
        className={styles.button}
        disabled={busy || owner.trim() === '' || repo.trim() === ''}
        data-testid={`picker-repo-browse-${fixedRepo ? 'canonical' : 'other'}`}
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
          {files.length === 0 && <li className={styles.hint}>No program files found.</li>}
          {files.map((file) => (
            <li key={file.path}>
              <button className={styles.fileButton} disabled={busy} onClick={() => void open(file)}>
                {file.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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
