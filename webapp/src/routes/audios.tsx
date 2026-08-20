import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import clsx from 'clsx';
import { useAudiosApi } from '../api/audios';
import type { AudioFile, BackendIssuePayload } from '../api/types';
import { BackendIssueBanner } from '../components/BackendIssueBanner';
import { useSettings } from '../context/SettingsContext';
import { useAdminStatus } from '../hooks/useAdminStatus';
import styles from './audios.module.css';

export const Route = createFileRoute('/audios')({
  component: AudiosView,
});

interface Feedback {
  kind: 'error' | 'info';
  text: string;
}

function titleFromFilename(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

function AudiosView(): React.ReactNode {
  const audiosApi = useAudiosApi();
  const queryClient = useQueryClient();
  const { adminModeEnabled } = useAdminStatus();
  const { adminToken } = useSettings();

  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [dismissedIssue, setDismissedIssue] = useState<BackendIssuePayload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Same rule as the run view: admin mode ON without a token means spectator.
  const canControl = !adminModeEnabled || adminToken !== null;

  const {
    data: audios,
    isLoading,
    error: listError,
  } = useQuery({
    queryKey: ['audios'],
    queryFn: audiosApi.list,
  });

  // `useSSE` parks the last `backend_issue` here; this view is its first
  // consumer. Read-only cache subscription, like the run view's `state`.
  const { data: backendIssue } = useQuery<BackendIssuePayload | null>({
    queryKey: ['backend-issue'],
    queryFn: async () => null,
    initialData: null,
    enabled: false,
  });

  const audioIssue =
    backendIssue !== null && backendIssue.code === 'audio_playback_failed' && backendIssue !== dismissedIssue
      ? backendIssue
      : null;

  function resetForm(): void {
    setTitle('');
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  const playMutation = useMutation({
    mutationFn: (clip: AudioFile) => audiosApi.play(clip.id),
    onSuccess: (_result, clip) => setFeedback({ kind: 'info', text: `Playing "${clip.title}" on the device.` }),
    onError: (mutationError: Error, clip) =>
      setFeedback({ kind: 'error', text: `Could not play "${clip.title}": ${mutationError.message}` }),
  });

  const deleteMutation = useMutation({
    mutationFn: (clip: AudioFile) => audiosApi.remove(clip.id),
    onSuccess: async (_result, clip) => {
      setPendingDeleteId(null);
      setFeedback({ kind: 'info', text: `Deleted "${clip.title}".` });
      await queryClient.invalidateQueries({ queryKey: ['audios'] });
    },
    onError: (mutationError: Error, clip) => {
      setPendingDeleteId(null);
      // Includes the 409 "Audio is currently playing" — the one refusal a user
      // can act on, by waiting for the clip to finish.
      setFeedback({ kind: 'error', text: `Could not delete "${clip.title}": ${mutationError.message}` });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: audiosApi.upload,
    onSuccess: async (created, request) => {
      resetForm();
      setFeedback({ kind: 'info', text: `Uploaded "${request.title}" as clip ${created.id}.` });
      await queryClient.invalidateQueries({ queryKey: ['audios'] });
    },
    onError: (mutationError: Error) => setFeedback({ kind: 'error', text: `Upload failed: ${mutationError.message}` }),
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    if (selected) {
      setTitle(titleFromFilename(selected.name));
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!file || title.trim().length === 0) {
      return;
    }
    setFeedback(null);
    uploadMutation.mutate({ file, title: title.trim() });
  }

  const sorted = audios ? [...audios].sort((a, b) => a.id - b.id) : [];

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Audios</h1>

      {audioIssue && <BackendIssueBanner issue={audioIssue} onDismiss={() => setDismissedIssue(audioIssue)} />}

      {feedback && (
        <div
          className={clsx(styles.feedback, feedback.kind === 'error' ? styles.feedbackError : styles.feedbackInfo)}
          role='status'
          data-testid='audios-feedback'
        >
          <span>{feedback.text}</span>
          <button
            type='button'
            className={styles.feedbackDismiss}
            onClick={() => setFeedback(null)}
            aria-label='Dismiss'
          >
            ×
          </button>
        </div>
      )}

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Upload a clip</h2>
        {canControl ? (
          <form className={styles.uploadForm} onSubmit={handleSubmit} data-testid='audios-upload-form'>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>WAV file</span>
              <input
                ref={fileInputRef}
                className={styles.input}
                type='file'
                accept='.wav'
                onChange={handleFileChange}
                data-testid='audios-upload-file'
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Title</span>
              <input
                className={styles.input}
                type='text'
                value={title}
                placeholder='Title'
                onChange={(event) => setTitle(event.target.value)}
                data-testid='audios-upload-title'
              />
            </label>
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              type='submit'
              disabled={!file || title.trim().length === 0 || uploadMutation.isPending}
              data-testid='audios-upload-submit'
            >
              {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
            </button>
            <p className={styles.hint}>16-bit PCM WAV, mono or stereo, up to 1 MiB.</p>
          </form>
        ) : (
          <div className={styles.viewOnlyBadge} data-testid='audios-view-only'>
            <span className={styles.viewOnlyIcon}>👁</span>
            <span>View Only - Login as admin to play, upload or delete</span>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Audio library</h2>

        {isLoading && <p className={styles.empty}>Loading clips…</p>}
        {listError && <p className={styles.empty}>Could not load clips: {(listError as Error).message}</p>}
        {!isLoading && !listError && sorted.length === 0 && <p className={styles.empty}>No clips on the device.</p>}

        {sorted.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope='col'>ID</th>
                <th scope='col'>Title</th>
                <th scope='col'>Source</th>
                <th scope='col'>File</th>
                <th scope='col' className={styles.actionsHeader}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((clip) => (
                <tr key={clip.id} data-testid={`audios-row-${clip.id}`}>
                  <td className={styles.idCell}>{clip.id}</td>
                  <td>{clip.title}</td>
                  <td>
                    <span
                      className={clsx(styles.badge, clip.readonly ? styles.badgeShipped : styles.badgeUploaded)}
                      data-testid={`audios-source-${clip.id}`}
                    >
                      {clip.readonly ? 'Shipped' : 'Uploaded'}
                    </span>
                  </td>
                  <td className={styles.fileCell}>{clip.filename}</td>
                  <td className={styles.actionsCell}>
                    {canControl ? (
                      <>
                        <button
                          className={clsx(styles.button, styles.buttonSecondary)}
                          type='button'
                          onClick={() => playMutation.mutate(clip)}
                          data-testid={`audios-play-${clip.id}`}
                        >
                          Play
                        </button>
                        {/* Shipped clips are flashed with the firmware: the
                            device answers 404 to a delete, so no button. */}
                        {!clip.readonly &&
                          (pendingDeleteId === clip.id ? (
                            <>
                              <button
                                className={clsx(styles.button, styles.buttonDestructive)}
                                type='button'
                                onClick={() => deleteMutation.mutate(clip)}
                                data-testid={`audios-delete-confirm-${clip.id}`}
                              >
                                Confirm
                              </button>
                              <button
                                className={clsx(styles.button, styles.buttonSecondary)}
                                type='button'
                                onClick={() => setPendingDeleteId(null)}
                                data-testid={`audios-delete-cancel-${clip.id}`}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className={clsx(styles.button, styles.buttonDestructiveGhost)}
                              type='button'
                              onClick={() => setPendingDeleteId(clip.id)}
                              data-testid={`audios-delete-${clip.id}`}
                            >
                              Delete
                            </button>
                          ))}
                      </>
                    ) : (
                      <span className={styles.noActions}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
