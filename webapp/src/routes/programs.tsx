import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import clsx from 'clsx';
import { useProgramsApi } from '../api/programs';
import type { Program, ProgramSummary, StateUpdatePayload } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NoticeBanner } from '../components/NoticeBanner';
import { ProgramDetails } from '../components/ProgramDetails';
import { ProgramEditor, type EditorTarget } from '../components/ProgramEditor';
import { downloadJson, programFilename } from '../lib/download';
import { useSettings } from '../context/SettingsContext';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { type DocumentIssue, parseProgramDocument } from '../lib/program-document';
import {
  failureNotice,
  issueLines,
  unloadFailureNotice,
  updateFailureNotice,
  type Notice,
} from '../lib/program-notices';
import styles from './programs.module.css';

export const Route = createFileRoute('/programs')({
  component: ProgramsView,
});

/** What the picked file is for: a new program, or a replacement for this id. */
type UploadTarget = { kind: 'create' } | { kind: 'replace'; id: number; title: string };

/** A validated document waiting to be sent, once its warnings have been seen. */
interface PendingUpload {
  target: UploadTarget;
  program: Program;
  warnings: DocumentIssue[];
  fileName: string;
}

export function ProgramsView(): React.ReactNode {
  const queryClient = useQueryClient();
  const programsApi = useProgramsApi();
  const { adminModeEnabled } = useAdminStatus();
  const { adminToken } = useSettings();

  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProgramSummary | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  // An upload the device would store differently from the file. Held here until
  // the user has seen what will change — for a replace that write is an
  // irreversible overwrite, so telling them afterwards is telling them too late.
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  // The WYSIWYG editor, open over the list. Null when the list is showing.
  const [editing, setEditing] = useState<EditorTarget | null>(null);

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

  // The inverse of Load, and it belongs on the same row: this page is where
  // the refusals that name unloading are raised - a replace against the loaded
  // program is a 409 that says to unload it (D-15/D-22) - so the instruction
  // and the button are in the same place.
  const unloadMutation = useMutation({
    mutationFn: () => programsApi.unload(),
    // Deliberately an outcome, not an event: a 200 means "nothing is loaded
    // now", and the device does not distinguish "just unloaded" from "nothing
    // was loaded" (D-22).
    onSuccess: () => setNotice({ kind: 'success', message: 'Nothing is loaded on the device now.' }),
    onError: (err) => setNotice(unloadFailureNotice(err)),
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
    mutationFn: (program: Program) => programsApi.create(program),
    onSuccess: (created, program) => {
      invalidatePrograms(created.id);
      setSelectedId(created.id);
      // The device assigns the id and ignores the document's, so say which one
      // it picked rather than letting the user assume the file's.
      setNotice({ kind: 'success', message: `Uploaded "${program.title}" as program ${created.id}.` });
    },
    onError: (err, program) => setNotice(failureNotice(err, `Could not upload "${program.title}".`)),
  });

  const updateMutation = useMutation({
    mutationFn: (upload: { id: number; program: Program }) => programsApi.update(upload.id, upload.program),
    onSuccess: (_stored, upload) => {
      invalidatePrograms(upload.id);
      setNotice({ kind: 'success', message: `Replaced program ${upload.id} with "${upload.program.title}".` });
    },
    onError: (err, upload) => setNotice(updateFailureNotice(err, upload.id)),
  });

  /** Send an upload the user has either nothing to be warned about, or has accepted. */
  function send(upload: PendingUpload): void {
    if (upload.target.kind === 'create') {
      createMutation.mutate(upload.program);
    } else {
      updateMutation.mutate({ id: upload.target.id, program: upload.program });
    }
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

    const upload: PendingUpload = {
      target,
      program: result.program,
      warnings: result.warnings,
      fileName: file.name,
    };

    // A file picked to replace one program but declaring another's id is a
    // mistake worth stopping on. `withoutId()` strips the id before sending, so
    // the device would in fact accept this — which is exactly why it is caught
    // here: silently writing "Fältträning" over program 140 because the picker
    // was pointed at the wrong row is not a recovery, it is the accident.
    if (target.kind === 'replace' && result.declaredId !== null && result.declaredId !== target.id) {
      setNotice({
        kind: 'error',
        message:
          `"${file.name}" declares id ${result.declaredId}, but it was picked to replace program ${target.id} ` +
          `("${target.title}"). The device does not renumber a program, so this is either the wrong file or the ` +
          'wrong row.',
        action: {
          label: 'Upload as a new program instead',
          run: () => confirmOrSend({ ...upload, target: { kind: 'create' } }),
        },
      });
      return;
    }

    confirmOrSend(upload);
  }

  /**
   * Nothing to warn about goes straight out; anything the device would store
   * differently is shown first. Both directions matter for a replace, where the
   * write cannot be undone.
   */
  function confirmOrSend(upload: PendingUpload): void {
    if (upload.warnings.length === 0) {
      send(upload);
      return;
    }
    setPendingUpload(upload);
  }

  const sorted = [...(programs ?? [])].sort((a, b) => a.id - b.id);
  const busy =
    loadMutation.isPending ||
    unloadMutation.isPending ||
    deleteMutation.isPending ||
    createMutation.isPending ||
    updateMutation.isPending;
  // The table holds summaries, not documents, so the file has to be fetched.
  const handleDownload = async (program: ProgramSummary): Promise<void> => {
    setDownloadingId(program.id);
    try {
      const document = await programsApi.get(program.id);
      downloadJson(programFilename(program.id), JSON.stringify(document, null, 2));
    } catch {
      setNotice({ kind: 'error', message: `Could not download "${program.title}" from the device.` });
    } finally {
      setDownloadingId(null);
    }
  };


  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Programs</h1>
        {canManage ? (
          <div className={styles.headerActions}>
            <button
              className={styles.button}
              data-testid='programs-upload'
              onClick={() => openFilePicker({ kind: 'create' })}
              disabled={busy || editing !== null}
            >
              Upload program…
            </button>
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              data-testid='programs-new'
              onClick={() => {
                setNotice(null);
                setSelectedId(null);
                setEditing({ kind: 'new' });
              }}
              disabled={busy || editing !== null}
            >
              New program
            </button>
          </div>
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

      {notice && <NoticeBanner notice={notice} testId='programs-notice' onDismiss={() => setNotice(null)} />}

      {editing !== null && (
        <ProgramEditor
          target={editing}
          onClose={() => setEditing(null)}
          onCreated={(id, title) => {
            setEditing(null);
            setSelectedId(id);
            // The device assigns the id and ignores the document's, so say
            // which one it picked — the same thing an upload reports.
            setNotice({ kind: 'success', message: `Saved "${title}" as program ${id}.` });
          }}
        />
      )}

      {editing === null && isPending && <p className={styles.message}>Loading programs…</p>}
      {editing === null && listError && <p className={styles.message}>Could not list programs: {listError.message}</p>}

      {editing === null && programs && (
        // The explicit roles are what keep this a table for assistive
        // technology on a phone, where the CSS restacks every row as a block
        // and `display` no longer implies the table roles.
        <div className={styles.tableScroll}>
          <table className={styles.table} data-testid='programs-table' role='table'>
            <thead role='rowgroup'>
              <tr role='row'>
                <th className={styles.idColumn} role='columnheader' scope='col'>
                  ID
                </th>
                <th role='columnheader' scope='col'>
                  Title
                </th>
                <th role='columnheader' scope='col'>
                  Description
                </th>
                <th role='columnheader' scope='col'>
                  Source
                </th>
                <th className={styles.actionsColumn} role='columnheader' scope='col'>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody role='rowgroup'>
              {sorted.map((program) => {
                const isLoaded = program.id === loadedProgramId;
                return (
                  <tr
                    key={program.id}
                    className={clsx(styles.row, isLoaded && styles.rowLoaded)}
                    data-testid={`program-row-${program.id}`}
                    role='row'
                  >
                    <td className={styles.idColumn} role='cell' data-label='ID'>
                      {program.id}
                    </td>
                    <td role='cell' data-label='Title'>
                      <button className={styles.titleButton} onClick={() => setSelectedId(program.id)}>
                        {program.title}
                      </button>
                      {isLoaded && <span className={clsx(styles.badge, styles.badgeLoaded)}>Loaded</span>}
                    </td>
                    <td className={styles.description} role='cell' data-label='About'>
                      {program.description}
                    </td>
                    <td role='cell' data-label='Source'>
                      {/* `readonly` means the program was flashed with the firmware:
                        there is no file behind it to replace or delete. */}
                      <span
                        className={clsx(styles.badge, program.readonly ? styles.badgeShipped : styles.badgeUploaded)}
                      >
                        {program.readonly ? 'Shipped' : 'Uploaded'}
                      </span>
                    </td>
                    <td className={styles.actionsColumn} role='cell' data-label='Actions'>
                      {/* Outside the canManage guard: downloading is reading,
                          and it is how a program leaves the device to be
                          committed to resources/. Shipped programs download
                          too - promoting a copy starts here. */}
                      <button
                        className={styles.button}
                        data-testid={`program-download-${program.id}`}
                        onClick={() => {
                          void handleDownload(program);
                        }}
                        disabled={downloadingId === program.id}
                      >
                        {downloadingId === program.id ? 'Downloading…' : 'Download'}
                      </button>
                      {canManage && (
                        <>
                          {/* One button, not a disabled Load beside an extra
                            Unload: the device holds one program, so this is a
                            state the row is in, and a control that toggles a
                            state should stay in one place. A disabled Load also
                            said the wrong thing - the action was unavailable,
                            when in fact the opposite action was the available
                            one. */}
                          <button
                            className={clsx(styles.button, styles.actionToggle)}
                            data-testid={isLoaded ? `program-unload-${program.id}` : `program-load-${program.id}`}
                            onClick={() => (isLoaded ? unloadMutation.mutate() : loadMutation.mutate(program))}
                            disabled={busy}
                          >
                            {isLoaded ? 'Unload' : 'Load'}
                          </button>
                          {/* A shipped program cannot be written back, so editing
                            one means editing a copy the device will store under
                            a new id. The legacy app offered no Edit at all on
                            these rows; downloading the JSON and uploading it
                            again was the whole flow. */}
                          <button
                            className={clsx(styles.button, styles.actionEdit)}
                            data-testid={`program-edit-${program.id}`}
                            onClick={() => {
                              setNotice(null);
                              setSelectedId(null);
                              setEditing(
                                program.readonly
                                  ? { kind: 'copy', sourceId: program.id, sourceTitle: program.title }
                                  : { kind: 'edit', id: program.id },
                              );
                            }}
                            disabled={busy}
                          >
                            {program.readonly ? 'Edit a copy…' : 'Edit…'}
                          </button>
                          {!program.readonly && (
                            <>
                              <button
                                className={styles.button}
                                data-testid={`program-replace-${program.id}`}
                                onClick={() =>
                                  openFilePicker({ kind: 'replace', id: program.id, title: program.title })
                                }
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
        </div>
      )}

      {editing === null && programs?.length === 0 && <p className={styles.message}>The device holds no programs.</p>}

      {editing === null && selectedId !== null && (
        <ProgramDetails id={selectedId} onClose={() => setSelectedId(null)} />
      )}

      {pendingUpload && (
        <ConfirmDialog
          title='The device will not store this file as written'
          body={
            <>
              <p>
                {pendingUpload.target.kind === 'replace'
                  ? `Replacing program ${pendingUpload.target.id} with "${pendingUpload.fileName}" cannot be undone. It will be stored as:`
                  : `"${pendingUpload.fileName}" will be stored as:`}
              </p>
              <ul data-testid='upload-warnings'>
                {pendingUpload.warnings.map((warning) => (
                  <li key={`${warning.path}:${warning.message}`}>
                    <code>{warning.path || '/'}</code> — {warning.message}
                  </li>
                ))}
              </ul>
            </>
          }
          confirmLabel={pendingUpload.target.kind === 'replace' ? 'Replace anyway' : 'Upload anyway'}
          destructive={pendingUpload.target.kind === 'replace'}
          onConfirm={() => {
            const upload = pendingUpload;
            setPendingUpload(null);
            send(upload);
          }}
          onCancel={() => setPendingUpload(null)}
        />
      )}

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
