import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import clsx from 'clsx';
import { ApiError } from '../api/client';
import { useProgramsApi } from '../api/programs';
import type { Program, ProgramSummary, StateUpdatePayload } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ProgramDetails } from '../components/ProgramDetails';
import { useSettings } from '../context/SettingsContext';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { type DocumentIssue, parseProgramDocument } from '../lib/program-document';
import styles from './programs.module.css';

export const Route = createFileRoute('/programs')({
  component: ProgramsView,
});

interface Notice {
  kind: 'error' | 'success' | 'warning';
  message: string;
  /** One line per point; used for the per-field validation output. */
  details?: string[];
  action?: { label: string; run: () => void };
}

/** What the picked file is for: a new program, or a replacement for this id. */
type UploadTarget = { kind: 'create' } | { kind: 'replace'; id: number; title: string };

function issueLines(issues: DocumentIssue[]): string[] {
  return issues.map((issue) => `${issue.path || '/'} — ${issue.message}`);
}

export function ProgramsView(): React.ReactNode {
  const queryClient = useQueryClient();
  const programsApi = useProgramsApi();
  const { adminModeEnabled } = useAdminStatus();
  const { adminToken } = useSettings();

  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProgramSummary | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // A ref, not state: the picker opens in the same tick as the click that sets
  // this, so a state update would not be visible to the change handler.
  const uploadTargetRef = useRef<UploadTarget>({ kind: 'create' });

  // Same gate the run view uses: writes are open while admin mode is off, and
  // need this browser's token once it is on.
  const canManage = !adminModeEnabled || adminToken !== null;

  const {
    data: programs,
    isPending,
    error: listError,
  } = useQuery({
    queryKey: ['programs'],
    queryFn: programsApi.list,
  });

  // Written by `useSSE`; read here for the "Loaded" marker and to explain the
  // 409 a loaded program answers an update with.
  const { data: state } = useQuery<StateUpdatePayload | null>({
    queryKey: ['state'],
    queryFn: async () => null,
    initialData: null,
    enabled: false,
  });
  const loadedProgramId = state?.loadedProgramId ?? null;

  function invalidatePrograms(id?: number): void {
    void queryClient.invalidateQueries({ queryKey: ['programs'] });
    if (id !== undefined) void queryClient.invalidateQueries({ queryKey: ['program', id] });
  }

  const loadMutation = useMutation({
    mutationFn: (program: ProgramSummary) => programsApi.load(program.id),
    onSuccess: (_data, program) => setNotice({ kind: 'success', message: `Loaded "${program.title}" on the device.` }),
    onError: (err, program) => setNotice(failureNotice(err, `Could not load "${program.title}".`)),
  });

  const deleteMutation = useMutation({
    mutationFn: (program: ProgramSummary) => programsApi.remove(program.id),
    onSuccess: (_data, program) => {
      invalidatePrograms(program.id);
      setSelectedId((current) => (current === program.id ? null : current));
      setNotice({ kind: 'success', message: `Deleted "${program.title}".` });
    },
    onError: (err, program) => setNotice(failureNotice(err, `Could not delete "${program.title}".`)),
  });

  const createMutation = useMutation({
    mutationFn: (upload: { program: Program; warnings: DocumentIssue[] }) => programsApi.create(upload.program),
    onSuccess: (created, upload) => {
      invalidatePrograms(created.id);
      setSelectedId(created.id);
      setNotice({
        // The device assigns the id and ignores the document's, so say which
        // one it picked rather than letting the user assume the file's.
        kind: upload.warnings.length > 0 ? 'warning' : 'success',
        message: `Uploaded "${upload.program.title}" as program ${created.id}.`,
        details: issueLines(upload.warnings),
      });
    },
    onError: (err, upload) => setNotice(failureNotice(err, `Could not upload "${upload.program.title}".`)),
  });

  const updateMutation = useMutation({
    mutationFn: (upload: { id: number; program: Program; warnings: DocumentIssue[] }) =>
      programsApi.update(upload.id, upload.program),
    onSuccess: (_stored, upload) => {
      invalidatePrograms(upload.id);
      setNotice({
        kind: upload.warnings.length > 0 ? 'warning' : 'success',
        message: `Replaced program ${upload.id} with "${upload.program.title}".`,
        details: issueLines(upload.warnings),
      });
    },
    onError: (err, upload) => setNotice(updateFailureNotice(err, upload.id)),
  });

  /**
   * Turn a rejected call into something a club member can act on. The device's
   * own message is the fallback, but the ones that need context get it here.
   */
  function failureNotice(err: unknown, prefix: string): Notice {
    if (err instanceof ApiError && err.status === 401) {
      return {
        kind: 'error',
        message: `${prefix} Admin mode is on and this browser is not signed in — sign in under Settings.`,
      };
    }
    return { kind: 'error', message: `${prefix} ${err instanceof Error ? err.message : String(err)}` };
  }

  function updateFailureNotice(err: unknown, id: number): Notice {
    if (err instanceof ApiError && err.status === 409) {
      if (/loaded/i.test(err.message)) {
        // D-15: run state holds a pointer into the stored program, so the
        // device refuses. There is no unload endpoint in v2 — loading another
        // program is how a client gets out of this.
        return {
          kind: 'error',
          message:
            `Program ${id} is the one currently loaded on the device, and a loaded program cannot be replaced — ` +
            'the run position points into it. Load a different program first, then replace this one.',
        };
      }
      return {
        kind: 'error',
        message: `Program ${id} is shipped with the firmware and cannot be replaced. Upload the file as a new program instead.`,
      };
    }
    if (err instanceof ApiError && err.status === 404) {
      return { kind: 'error', message: `Program ${id} is no longer on the device.` };
    }
    return failureNotice(err, `Could not replace program ${id}.`);
  }

  function openFilePicker(target: UploadTarget): void {
    uploadTargetRef.current = target;
    setNotice(null);
    fileInputRef.current?.click();
  }

  async function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Cleared unconditionally so picking the same file twice still fires.
    event.target.value = '';
    if (!file) return;

    const target = uploadTargetRef.current;
    const result = parseProgramDocument(await file.text());

    if (!result.ok) {
      setNotice({
        kind: 'error',
        message: `"${file.name}" is not a program the device will accept.`,
        details: issueLines(result.errors),
      });
      return;
    }

    if (target.kind === 'create') {
      createMutation.mutate({ program: result.program, warnings: result.warnings });
      return;
    }

    // The path owns the id (D-15), so a document declaring a different one is a
    // 400 from the device. Refused here instead, where the alternative can be
    // offered rather than guessed at.
    if (result.declaredId !== null && result.declaredId !== target.id) {
      setNotice({
        kind: 'error',
        message:
          `"${file.name}" declares id ${result.declaredId}, but it was picked to replace program ${target.id} ` +
          `("${target.title}"). The device will not renumber a program.`,
        action: {
          label: 'Upload as a new program instead',
          run: () => createMutation.mutate({ program: result.program, warnings: result.warnings }),
        },
      });
      return;
    }

    updateMutation.mutate({ id: target.id, program: result.program, warnings: result.warnings });
  }

  const sorted = [...(programs ?? [])].sort((a, b) => a.id - b.id);
  const busy =
    loadMutation.isPending || deleteMutation.isPending || createMutation.isPending || updateMutation.isPending;

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Programs</h1>
        {canManage ? (
          <button
            className={clsx(styles.button, styles.buttonPrimary)}
            data-testid='programs-upload'
            onClick={() => openFilePicker({ kind: 'create' })}
            disabled={busy}
          >
            Upload program…
          </button>
        ) : (
          <div className={styles.viewOnlyBadge} data-testid='programs-view-only'>
            <span aria-hidden='true'>👁</span>
            <span>View Only — log in as admin to manage programs</span>
          </div>
        )}
      </header>

      <input
        ref={fileInputRef}
        className={styles.fileInput}
        type='file'
        accept='application/json,.json'
        data-testid='programs-file-input'
        onChange={(event) => void handleFileChosen(event)}
      />

      {notice && (
        <div className={clsx(styles.notice, styles[notice.kind])} role='status' data-testid='programs-notice'>
          <p className={styles.noticeMessage}>{notice.message}</p>
          {notice.details && notice.details.length > 0 && (
            <ul className={styles.noticeDetails}>
              {notice.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div className={styles.noticeActions}>
            {notice.action && (
              <button
                className={styles.button}
                data-testid='programs-notice-action'
                onClick={() => {
                  const run = notice.action?.run;
                  setNotice(null);
                  run?.();
                }}
              >
                {notice.action.label}
              </button>
            )}
            <button className={styles.button} onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {isPending && <p className={styles.message}>Loading programs…</p>}
      {listError && <p className={styles.message}>Could not list programs: {listError.message}</p>}

      {programs && (
        <table className={styles.table} data-testid='programs-table'>
          <thead>
            <tr>
              <th className={styles.idColumn}>ID</th>
              <th>Title</th>
              <th>Description</th>
              <th>Source</th>
              <th className={styles.actionsColumn}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((program) => {
              const isLoaded = program.id === loadedProgramId;
              return (
                <tr
                  key={program.id}
                  className={clsx(styles.row, isLoaded && styles.rowLoaded)}
                  data-testid={`program-row-${program.id}`}
                >
                  <td className={styles.idColumn}>{program.id}</td>
                  <td>
                    <button className={styles.titleButton} onClick={() => setSelectedId(program.id)}>
                      {program.title}
                    </button>
                    {isLoaded && <span className={clsx(styles.badge, styles.badgeLoaded)}>Loaded</span>}
                  </td>
                  <td className={styles.description}>{program.description}</td>
                  <td>
                    {/* `readonly` means the program was flashed with the firmware:
                        there is no file behind it to replace or delete. */}
                    <span className={clsx(styles.badge, program.readonly ? styles.badgeShipped : styles.badgeUploaded)}>
                      {program.readonly ? 'Shipped' : 'Uploaded'}
                    </span>
                  </td>
                  <td className={styles.actionsColumn}>
                    {canManage && (
                      <>
                        <button
                          className={styles.button}
                          data-testid={`program-load-${program.id}`}
                          onClick={() => loadMutation.mutate(program)}
                          disabled={busy || isLoaded}
                        >
                          Load
                        </button>
                        {!program.readonly && (
                          <>
                            <button
                              className={styles.button}
                              data-testid={`program-replace-${program.id}`}
                              onClick={() => openFilePicker({ kind: 'replace', id: program.id, title: program.title })}
                              disabled={busy}
                            >
                              Replace…
                            </button>
                            <button
                              className={clsx(styles.button, styles.buttonDestructive)}
                              data-testid={`program-delete-${program.id}`}
                              onClick={() => setPendingDelete(program)}
                              disabled={busy}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {programs?.length === 0 && <p className={styles.message}>The device holds no programs.</p>}

      {selectedId !== null && <ProgramDetails id={selectedId} onClose={() => setSelectedId(null)} />}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete "${pendingDelete.title}"?`}
          body={
            pendingDelete.id === loadedProgramId
              ? 'This is the program currently loaded on the device. Deleting it unloads it first.'
              : 'The program file is removed from the device. This cannot be undone.'
          }
          confirmLabel='Delete'
          destructive
          onConfirm={() => {
            const program = pendingDelete;
            setPendingDelete(null);
            deleteMutation.mutate(program);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
