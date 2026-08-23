import { useMemo, useState } from 'react';
import type { Program } from '../api/types';
import { downloadJson, programFilename } from '../lib/download';
import { PROGRAMS_PATH, buildNewFileUrl, prCommitMessage, prDescription, type PrContext } from '../lib/pr-url';
import styles from './ExportPanel.module.css';

interface ExportPanelProps {
  /** Already carries the id and `readonly: true` a shipped file needs — see `send()` in ProgramEditor. */
  program: Program;
  origin: string;
  onClose: () => void;
}

const DEFAULT_OWNER = 'Malmo-Skyttegille-Pistolsektionen';
const DEFAULT_REPO = 'rotation_target';

/**
 * Where a program authored without a device goes next (#140): download it,
 * or hand GitHub a prefilled new-file URL so committing it opens a pull
 * request with no token involved. Rendered by `ProgramEditor` in place of a
 * device save.
 */
export function ExportPanel({ program, origin, onClose }: ExportPanelProps): React.ReactNode {
  const [owner, setOwner] = useState(DEFAULT_OWNER);
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [copied, setCopied] = useState<'message' | 'description' | null>(null);

  const json = useMemo(() => JSON.stringify(program, null, 2), [program]);
  const ctx: PrContext = { id: program.id, title: program.title, origin };
  const message = prCommitMessage(ctx);
  const description = prDescription(ctx);
  const filename = programFilename(program.id);

  const { url, byteLength, overBudget } = useMemo(
    () => buildNewFileUrl(owner, repo, json, { id: program.id, title: program.title, origin }),
    [owner, repo, json, program.id, program.title, origin],
  );

  function copy(text: string, which: 'message' | 'description'): void {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(which);
        setTimeout(() => setCopied(null), 2000);
      },
      () => {
        // Clipboard access denied or unavailable; the text is still selectable.
      },
    );
  }

  return (
    <section className={styles.panel} data-testid='export-panel'>
      <h3 className={styles.title}>Get program {program.id} onto GitHub</h3>
      <p className={styles.hint}>
        No device is involved from here on — this authors{' '}
        <code>
          {PROGRAMS_PATH}/{filename}
        </code>{' '}
        for review as a pull request.
      </p>

      <button
        className={styles.button}
        data-testid='export-download'
        onClick={() => {
          downloadJson(filename, json);
        }}
      >
        Download {filename}
      </button>

      <div className={styles.repoRow}>
        <label className={styles.field}>
          <span>Repo owner</span>
          <input
            className={styles.input}
            value={owner}
            data-testid='export-owner'
            onChange={(event) => setOwner(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Repo name</span>
          <input
            className={styles.input}
            value={repo}
            data-testid='export-repo'
            onChange={(event) => setRepo(event.target.value)}
          />
        </label>
      </div>

      {overBudget ? (
        <p className={styles.warning} data-testid='export-oversized'>
          As a link this program is {String(Math.ceil(byteLength / 1024))} KB — over the roughly 8 KB that GitHub and
          browsers cap a URL at in practice, so a prefilled link would break rather than open. Use Download above, then
          add the file to the repo through GitHub's own file uploader (Add file → Upload files) instead.
        </p>
      ) : (
        <a className={styles.button} data-testid='export-pr-link' href={url} target='_blank' rel='noreferrer noopener'>
          Open a pull request on GitHub
        </a>
      )}

      <div className={styles.copyRow}>
        <p className={styles.hint}>
          The link tries to prefill the commit title and description too, which GitHub does not document — if the form
          it opens is blank, paste these in:
        </p>
        <label className={styles.field}>
          <span>Commit title</span>
          <div className={styles.copyLine}>
            <input className={styles.input} readOnly value={message} data-testid='export-title-text' />
            <button
              className={styles.button}
              type='button'
              onClick={() => {
                copy(message, 'message');
              }}
            >
              {copied === 'message' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </label>
        <label className={styles.field}>
          <span>Description</span>
          <div className={styles.copyLine}>
            <textarea className={styles.textarea} readOnly value={description} data-testid='export-description-text' />
            <button
              className={styles.button}
              type='button'
              onClick={() => {
                copy(description, 'description');
              }}
            >
              {copied === 'description' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </label>
      </div>

      <button className={styles.button} data-testid='export-close' onClick={onClose}>
        Close
      </button>
    </section>
  );
}
