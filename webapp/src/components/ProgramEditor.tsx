import { useReducer, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useAudiosApi } from '../api/audios';
import { useProgramsApi } from '../api/programs';
import type { AudioFile, Program } from '../api/types';
import { authoringIssues, parseProgramDocument, type DocumentIssue } from '../lib/program-document';
import {
  createEditorState,
  durationMs,
  editorReducer,
  isDirty,
  seriesMs,
  toJson,
  toPreviewProgram,
  type DraftCommand,
  type DraftEvent,
  type DraftSeries,
  type EditorAction,
} from '../lib/program-editor';
import { failureNotice, issueLines, updateFailureNotice, type Notice } from '../lib/program-notices';
import { ConfirmDialog } from './ConfirmDialog';
import { NoticeBanner } from './NoticeBanner';
import { Timeline } from './Timeline';
import styles from './ProgramEditor.module.css';

/**
 * What the session is for. `copy` and `edit` both need the full document —
 * `GET /programs` returns summaries — so both are fetched before the form
 * opens; `new` starts from nothing.
 */
export type EditorTarget =
  { kind: 'new' } | { kind: 'copy'; sourceId: number; sourceTitle: string } | { kind: 'edit'; id: number };

interface ProgramEditorProps {
  target: EditorTarget;
  onClose: () => void;
  /** A `POST` succeeded: the device assigned this id, and the editor is done. */
  onCreated: (id: number, title: string) => void;
}

/**
 * The WYSIWYG program editor: everything the legacy editor's five view tabs
 * did, over one document.
 *
 * Form, Events and Timeline were three renderings of the same edit operations
 * in the legacy app, each with its own copy of the reorder, selection and
 * context-menu code (#73). Here there is one structured editor — with the
 * Events view's cross-series selection and batch delete folded into it — plus
 * the JSON the device will actually receive, and the read-only timeline
 * underneath both as a preview.
 */
export function ProgramEditor({ target, onClose, onCreated }: ProgramEditorProps): React.ReactNode {
  const programsApi = useProgramsApi();
  const sourceId = target.kind === 'new' ? null : target.kind === 'copy' ? target.sourceId : target.id;

  const {
    data: source,
    isPending,
    error,
  } = useQuery({
    queryKey: ['program', sourceId],
    queryFn: () => programsApi.get(sourceId as number),
    enabled: sourceId !== null,
    staleTime: Infinity,
  });

  if (sourceId !== null && isPending) {
    return (
      <section className={styles.editor} data-testid='program-editor'>
        <p className={styles.message}>Loading program {sourceId}…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.editor} data-testid='program-editor'>
        <p className={styles.message}>
          Could not open program {sourceId}: {error.message}
        </p>
        <button className={styles.button} onClick={onClose}>
          Close
        </button>
      </section>
    );
  }

  // Keyed on the source so a second Edit on another row rebuilds the reducer
  // rather than reusing the first program's draft.
  return (
    <ProgramEditorForm
      key={`${target.kind}-${sourceId ?? 'new'}`}
      target={target}
      source={source ?? null}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

interface FormProps extends ProgramEditorProps {
  source: Program | null;
}

type Tab = 'editor' | 'json';

function ProgramEditorForm({ target, source, onClose, onCreated }: FormProps): React.ReactNode {
  const queryClient = useQueryClient();
  const programsApi = useProgramsApi();
  const audiosApi = useAudiosApi();

  const [state, dispatch] = useReducer(editorReducer, source, (program: Program | null) =>
    createEditorState(
      // A copy carries the shipped document's content and none of its identity:
      // the title says so, because two rows reading "Fältträning" with only the
      // Shipped badge between them is the accident waiting to happen.
      program !== null && target.kind === 'copy' ? { ...program, title: `${program.title} (copy)` } : program,
    ),
  );
  const [tab, setTab] = useState<Tab>('editor');
  const [json, setJson] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<{ program: Program; warnings: DocumentIssue[] } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const { data: audios } = useQuery({ queryKey: ['audios'], queryFn: audiosApi.list });

  const dirty = isDirty(state);

  // Navigating away from the tab drops the draft, and the legacy editor's
  // Cancel did it without a word. `enableBeforeUnload` covers closing the tab.
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  const createMutation = useMutation({
    mutationFn: (program: Program) => programsApi.create(program),
    onSuccess: (created, program) => {
      void queryClient.invalidateQueries({ queryKey: ['programs'] });
      onCreated(created.id, program.title);
    },
    onError: (err, program) => setNotice(failureNotice(err, `Could not save "${program.title}".`)),
  });

  const updateMutation = useMutation({
    mutationFn: (upload: { id: number; program: Program }) => programsApi.update(upload.id, upload.program),
    onSuccess: (stored, upload) => {
      void queryClient.invalidateQueries({ queryKey: ['programs'] });
      void queryClient.invalidateQueries({ queryKey: ['program', upload.id] });
      // The response is what the device stored, so the draft becomes that
      // rather than what was sent — and is clean against it.
      dispatch({ type: 'saved', program: stored });
      setJson(null);
      setNotice({ kind: 'success', message: `Saved program ${upload.id} — "${stored.title}".` });
    },
    // Left open on purpose: a 409 means the save has to be retried after
    // loading something else, and closing would throw the edits away.
    onError: (err, upload) => setNotice(updateFailureNotice(err, upload.id)),
  });

  const busy = createMutation.isPending || updateMutation.isPending;

  /** The JSON view's text: the draft, unless the user has typed over it. */
  const jsonText = json ?? toJson(state.draft);

  /**
   * Pull the JSON view's text back into the document, the way the legacy
   * editor's `syncJsonToProgram` did on a tab switch.
   *
   * Only a document the validator accepts is applied, and what is applied is
   * the validator's output — what the device would store — so a clamp or a
   * dropped field shows up in the form rather than surviving in the text until
   * the save. Returns false when the text cannot be applied.
   */
  function applyJson(): boolean {
    if (json === null) return true;
    const result = parseProgramDocument(json);
    if (!result.ok) {
      setNotice({
        kind: 'error',
        message: 'The JSON is not a program the device will accept, so the form was left as it was.',
        details: issueLines(result.errors),
      });
      return false;
    }
    dispatch({ type: 'replaceDocument', program: result.program });
    setJson(null);
    setNotice(
      result.warnings.length > 0
        ? {
            kind: 'warning',
            message: 'Applied as the device would store it:',
            details: issueLines(result.warnings),
          }
        : null,
    );
    return true;
  }

  function selectTab(next: Tab): void {
    if (next === tab) return;
    if (next === 'editor' && !applyJson()) return;
    if (next === 'json') setNotice(null);
    setTab(next);
  }

  function send(program: Program): void {
    if (target.kind === 'edit') {
      updateMutation.mutate({ id: target.id, program });
    } else {
      createMutation.mutate(program);
    }
  }

  /**
   * Save: the draft goes out through the same validator a picked file does, so
   * the clamps and drops the device would apply are seen here rather than
   * discovered on the next boot.
   */
  function handleSave(): void {
    // Unapplied JSON is what the user is looking at, so it is what gets saved —
    // the legacy editor's `syncJsonToProgram` on the way out of the tab.
    const pendingJson = json;
    const result = parseProgramDocument(pendingJson ?? toJson(state.draft));

    if (!result.ok) {
      setNotice({
        kind: 'error',
        message: 'This program cannot be saved yet.',
        details: issueLines(result.errors),
      });
      return;
    }

    // The form and the text now agree, on the document the device would store.
    if (pendingJson !== null) {
      dispatch({ type: 'replaceDocument', program: result.program });
      setJson(null);
    }

    const authoring = authoringIssues(result.program);
    if (authoring.length > 0) {
      setNotice({ kind: 'error', message: 'This program cannot be saved yet.', details: issueLines(authoring) });
      return;
    }

    if (result.warnings.length > 0) {
      setPendingWarnings({ program: result.program, warnings: result.warnings });
      return;
    }

    setNotice(null);
    send(result.program);
  }

  function handleClose(): void {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  const heading =
    target.kind === 'edit'
      ? `Editing program ${target.id}`
      : target.kind === 'copy'
        ? `New program, copied from "${target.sourceTitle}"`
        : 'New program';

  const eventCount = state.draft.series.reduce((count, series) => count + series.events.length, 0);

  return (
    <section className={styles.editor} data-testid='program-editor'>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title} data-testid='editor-heading'>
            {heading}
          </h2>
          <p className={styles.meta} data-testid='editor-meta'>
            {state.draft.series.length} series · {eventCount} events
            {dirty && (
              <>
                {' · '}
                <span className={styles.dirty} data-testid='editor-dirty'>
                  unsaved changes
                </span>
              </>
            )}
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.tabs} role='tablist'>
            <button
              role='tab'
              aria-selected={tab === 'editor'}
              className={clsx(styles.tab, tab === 'editor' && styles.tabActive)}
              data-testid='editor-tab-editor'
              onClick={() => selectTab('editor')}
            >
              Editor
            </button>
            <button
              role='tab'
              aria-selected={tab === 'json'}
              className={clsx(styles.tab, tab === 'json' && styles.tabActive)}
              data-testid='editor-tab-json'
              onClick={() => selectTab('json')}
            >
              JSON
            </button>
          </div>
          <button className={styles.button} data-testid='editor-cancel' onClick={handleClose} disabled={busy}>
            Close
          </button>
          <button
            className={clsx(styles.button, styles.buttonPrimary)}
            data-testid='editor-save'
            onClick={handleSave}
            disabled={busy}
          >
            {target.kind === 'edit' ? 'Save' : 'Create'}
          </button>
        </div>
      </header>

      {notice && <NoticeBanner notice={notice} testId='editor-notice' onDismiss={() => setNotice(null)} />}

      {tab === 'editor' ? (
        <StructuredEditor state={state} dispatch={dispatch} audios={audios ?? []} />
      ) : (
        <JsonEditor
          text={jsonText}
          result={parseProgramDocument(jsonText)}
          onChange={setJson}
          onFormat={() => {
            try {
              setJson(JSON.stringify(JSON.parse(jsonText), null, 2));
            } catch {
              // Not JSON yet; the errors under the textarea already say so.
            }
          }}
        />
      )}

      <div className={styles.preview}>
        <h3 className={styles.sectionTitle}>Preview</h3>
        <Timeline
          program={toPreviewProgram(state.draft)}
          currentSeriesIndex={null}
          currentEventIndex={null}
          tickerMs={null}
        />
      </div>

      {pendingWarnings && (
        <ConfirmDialog
          title='The device will not store this program as written'
          body={
            <>
              <p>It will be stored as:</p>
              <ul data-testid='editor-warnings'>
                {pendingWarnings.warnings.map((warning) => (
                  <li key={`${warning.path}:${warning.message}`}>
                    <code>{warning.path || '/'}</code> — {warning.message}
                  </li>
                ))}
              </ul>
            </>
          }
          confirmLabel={target.kind === 'edit' ? 'Save anyway' : 'Create anyway'}
          destructive={target.kind === 'edit'}
          onConfirm={() => {
            const pending = pendingWarnings;
            setPendingWarnings(null);
            setNotice(null);
            send(pending.program);
          }}
          onCancel={() => setPendingWarnings(null)}
        />
      )}

      {confirmDiscard && (
        <ConfirmDialog
          title='Discard unsaved changes?'
          body='This program has edits that have not been sent to the device. Closing the editor loses them.'
          confirmLabel='Discard'
          destructive
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      {blocker.status === 'blocked' && (
        <ConfirmDialog
          title='Leave the editor?'
          body='This program has edits that have not been sent to the device. Leaving this page loses them.'
          confirmLabel='Leave'
          destructive
          onConfirm={blocker.proceed}
          onCancel={blocker.reset}
        />
      )}
    </section>
  );
}

// --- The structured editor ---

interface StructuredEditorProps {
  state: ReturnType<typeof createEditorState>;
  dispatch: React.Dispatch<EditorAction>;
  audios: AudioFile[];
}

function StructuredEditor({ state, dispatch, audios }: StructuredEditorProps): React.ReactNode {
  const { draft, collapsed, selection } = state;

  return (
    <div className={styles.form}>
      <div className={styles.programFields}>
        <label className={styles.field}>
          <span className={styles.label}>Title</span>
          <input
            className={styles.input}
            data-testid='editor-title'
            value={draft.title}
            onChange={(event) => dispatch({ type: 'setTitle', value: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Description</span>
          <input
            className={styles.input}
            data-testid='editor-description'
            value={draft.description}
            onChange={(event) => dispatch({ type: 'setDescription', value: event.target.value })}
          />
        </label>
      </div>

      <div className={styles.toolbar}>
        <button
          className={styles.button}
          data-testid='editor-add-series'
          onClick={() => dispatch({ type: 'addSeries' })}
        >
          Add series
        </button>
        <button className={styles.button} onClick={() => dispatch({ type: 'setAllCollapsed', collapsed: true })}>
          Collapse all
        </button>
        <button className={styles.button} onClick={() => dispatch({ type: 'setAllCollapsed', collapsed: false })}>
          Expand all
        </button>
        <span className={styles.spacer} />
        <button
          className={styles.button}
          data-testid='editor-select-all'
          onClick={() => dispatch({ type: 'selectAllEvents' })}
        >
          Select all events
        </button>
        {selection.length > 0 && (
          <>
            <span className={styles.selectionCount} data-testid='editor-selection-count'>
              {selection.length} selected
            </span>
            <button
              className={clsx(styles.button, styles.buttonDestructive)}
              data-testid='editor-delete-selected'
              onClick={() => dispatch({ type: 'removeSelected' })}
            >
              Delete selected
            </button>
            <button className={styles.button} onClick={() => dispatch({ type: 'clearSelection' })}>
              Clear selection
            </button>
          </>
        )}
      </div>

      {draft.series.map((series, seriesIndex) => (
        <SeriesCard
          key={series.key}
          series={series}
          seriesIndex={seriesIndex}
          seriesCount={draft.series.length}
          collapsed={collapsed.includes(series.key)}
          selection={selection}
          audios={audios}
          dispatch={dispatch}
        />
      ))}
    </div>
  );
}

interface SeriesCardProps {
  series: DraftSeries;
  seriesIndex: number;
  seriesCount: number;
  collapsed: boolean;
  selection: string[];
  audios: AudioFile[];
  dispatch: React.Dispatch<EditorAction>;
}

function SeriesCard({
  series,
  seriesIndex,
  seriesCount,
  collapsed,
  selection,
  audios,
  dispatch,
}: SeriesCardProps): React.ReactNode {
  const seconds = Math.round(seriesMs(series) / 100) / 10;

  return (
    <div className={styles.series} data-testid={`editor-series-${seriesIndex}`}>
      <div className={styles.seriesHeader}>
        <button
          className={styles.collapseButton}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} series ${seriesIndex + 1}`}
          data-testid={`editor-series-${seriesIndex}-collapse`}
          onClick={() => dispatch({ type: 'toggleCollapsed', key: series.key })}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className={styles.seriesNumber}>{seriesIndex + 1}</span>
        <input
          className={clsx(styles.input, styles.seriesName)}
          placeholder='Series name'
          aria-label={`Name of series ${seriesIndex + 1}`}
          data-testid={`editor-series-${seriesIndex}-name`}
          value={series.name}
          onChange={(event) => dispatch({ type: 'setSeriesName', series: seriesIndex, value: event.target.value })}
        />
        <label className={styles.checkbox}>
          <input
            type='checkbox'
            data-testid={`editor-series-${seriesIndex}-optional`}
            checked={series.optional}
            onChange={(event) =>
              dispatch({ type: 'setSeriesOptional', series: seriesIndex, value: event.target.checked })
            }
          />
          Optional
        </label>
        <span className={styles.seriesMeta} data-testid={`editor-series-${seriesIndex}-meta`}>
          {series.events.length} events · {seconds} s
        </span>
        <RowActions
          prefix={`editor-series-${seriesIndex}`}
          what={`series ${seriesIndex + 1}`}
          canMoveUp={seriesIndex > 0}
          canMoveDown={seriesIndex < seriesCount - 1}
          canDelete={seriesCount > 1}
          onUp={() => dispatch({ type: 'moveSeries', from: seriesIndex, to: seriesIndex - 1 })}
          onDown={() => dispatch({ type: 'moveSeries', from: seriesIndex, to: seriesIndex + 1 })}
          onDuplicate={() => dispatch({ type: 'duplicateSeries', series: seriesIndex })}
          onDelete={() => dispatch({ type: 'removeSeries', series: seriesIndex })}
        />
      </div>

      {!collapsed && (
        <>
          {series.events.map((event, eventIndex) => (
            <EventRow
              key={event.key}
              event={event}
              seriesIndex={seriesIndex}
              eventIndex={eventIndex}
              eventCount={series.events.length}
              selected={selection.includes(event.key)}
              audios={audios}
              dispatch={dispatch}
            />
          ))}
          <button
            className={styles.button}
            data-testid={`editor-series-${seriesIndex}-add-event`}
            onClick={() => dispatch({ type: 'addEvent', series: seriesIndex })}
          >
            Add event
          </button>
        </>
      )}
    </div>
  );
}

const COMMANDS: { value: DraftCommand; label: string }[] = [
  { value: 'show', label: 'Show' },
  { value: 'hide', label: 'Hide' },
  { value: 'none', label: 'No change' },
];

interface EventRowProps {
  event: DraftEvent;
  seriesIndex: number;
  eventIndex: number;
  eventCount: number;
  selected: boolean;
  audios: AudioFile[];
  dispatch: React.Dispatch<EditorAction>;
}

function EventRow({
  event,
  seriesIndex,
  eventIndex,
  eventCount,
  selected,
  audios,
  dispatch,
}: EventRowProps): React.ReactNode {
  const testId = `editor-event-${seriesIndex}-${eventIndex}`;
  const ms = durationMs(event);

  return (
    <div className={styles.event} data-testid={testId}>
      <input
        type='checkbox'
        aria-label={`Select event ${eventIndex + 1} of series ${seriesIndex + 1}`}
        data-testid={`${testId}-select`}
        checked={selected}
        onChange={() => dispatch({ type: 'toggleSelected', key: event.key })}
      />
      <span className={styles.eventNumber}>{eventIndex + 1}</span>

      <label className={styles.field}>
        <span className={styles.label}>Duration (ms)</span>
        <span className={styles.durationRow}>
          <input
            className={clsx(styles.input, styles.duration)}
            type='number'
            min={1}
            max={3600000}
            step={100}
            aria-label={`Duration of event ${eventIndex + 1} of series ${seriesIndex + 1}, in milliseconds`}
            data-testid={`${testId}-duration`}
            value={event.duration}
            onChange={(change) =>
              dispatch({
                type: 'setEventDuration',
                series: seriesIndex,
                event: eventIndex,
                value: change.target.value,
              })
            }
          />
          {/* Milliseconds is what the device stores and what the field holds;
              the seconds are the number the shooter on the line hears. */}
          <span className={styles.hint} data-testid={`${testId}-seconds`}>
            {ms === null ? '—' : `${Math.round(ms / 100) / 10} s`}
          </span>
        </span>
      </label>

      <fieldset className={styles.commands}>
        <legend className={styles.label}>Targets</legend>
        {COMMANDS.map((command) => (
          <label key={command.value} className={styles.checkbox}>
            <input
              type='radio'
              name={`${testId}-command`}
              data-testid={`${testId}-command-${command.value}`}
              checked={event.command === command.value}
              onChange={() =>
                dispatch({ type: 'setEventCommand', series: seriesIndex, event: eventIndex, value: command.value })
              }
            />
            {command.label}
          </label>
        ))}
      </fieldset>

      <AudioPicker
        testId={testId}
        audioIds={event.audioIds}
        audios={audios}
        onAdd={(audioId) => dispatch({ type: 'addAudio', series: seriesIndex, event: eventIndex, audioId })}
        onRemove={(index) => dispatch({ type: 'removeAudio', series: seriesIndex, event: eventIndex, index })}
        onMove={(from, to) => dispatch({ type: 'moveAudio', series: seriesIndex, event: eventIndex, from, to })}
      />

      <RowActions
        prefix={testId}
        what={`event ${eventIndex + 1} of series ${seriesIndex + 1}`}
        canMoveUp={eventIndex > 0}
        canMoveDown={eventIndex < eventCount - 1}
        canDelete
        onUp={() => dispatch({ type: 'moveEvent', series: seriesIndex, from: eventIndex, to: eventIndex - 1 })}
        onDown={() => dispatch({ type: 'moveEvent', series: seriesIndex, from: eventIndex, to: eventIndex + 1 })}
        onDuplicate={() => dispatch({ type: 'duplicateEvent', series: seriesIndex, event: eventIndex })}
        onDelete={() => dispatch({ type: 'removeEvent', series: seriesIndex, event: eventIndex })}
      />
    </div>
  );
}

interface AudioPickerProps {
  testId: string;
  audioIds: number[];
  audios: AudioFile[];
  onAdd: (audioId: number) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

/**
 * The clips an event starts, in the order they are listed.
 *
 * The device's shipped titles are still bare numbers for most clips, so both
 * the id and the title are shown; matching on either is what makes the list
 * usable at all until the titles are filled in.
 */
function AudioPicker({ testId, audioIds, audios, onAdd, onRemove, onMove }: AudioPickerProps): React.ReactNode {
  const [search, setSearch] = useState('');

  const term = search.trim().toLowerCase();
  const available = audios.filter(
    (audio) =>
      !audioIds.includes(audio.id) &&
      (term === '' || String(audio.id).includes(term) || audio.title.toLowerCase().includes(term)),
  );

  function titleOf(id: number): string {
    const audio = audios.find((entry) => entry.id === id);
    return audio ? `${audio.id} · ${audio.title}` : `${id} (not on the device)`;
  }

  return (
    <div className={styles.audio}>
      <span className={styles.label}>Audio</span>
      <ul className={styles.chips} data-testid={`${testId}-audio-ids`}>
        {audioIds.map((id, index) => (
          <li key={id} className={styles.chip}>
            <span>{titleOf(id)}</span>
            <button
              className={styles.chipButton}
              aria-label={`Move clip ${id} earlier`}
              data-testid={`${testId}-audio-${id}-earlier`}
              disabled={index === 0}
              onClick={() => onMove(index, index - 1)}
            >
              ←
            </button>
            <button
              className={styles.chipButton}
              aria-label={`Move clip ${id} later`}
              data-testid={`${testId}-audio-${id}-later`}
              disabled={index === audioIds.length - 1}
              onClick={() => onMove(index, index + 1)}
            >
              →
            </button>
            <button
              className={styles.chipButton}
              aria-label={`Remove clip ${id}`}
              data-testid={`${testId}-audio-${id}-remove`}
              onClick={() => onRemove(index)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <span className={styles.audioControls}>
        <input
          className={clsx(styles.input, styles.audioSearch)}
          placeholder='Search clips'
          aria-label='Search audio clips'
          data-testid={`${testId}-audio-search`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className={styles.input}
          aria-label='Add an audio clip'
          data-testid={`${testId}-audio-add`}
          value=''
          onChange={(event) => {
            if (event.target.value !== '') onAdd(Number(event.target.value));
          }}
        >
          <option value=''>Add clip…</option>
          {available.map((audio) => (
            <option key={audio.id} value={audio.id}>
              {audio.id} · {audio.title}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

interface RowActionsProps {
  prefix: string;
  what: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  onUp: () => void;
  onDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * Move, copy and delete for a series or an event.
 *
 * Buttons rather than the legacy `⋮` menu and drag handles: the same four
 * operations, reachable from the keyboard, without a menu to position or a
 * drag to lose. Move-to-top and move-to-bottom are gone with the menu — a
 * program has a handful of series, and repeating a step is not the cost the
 * menu was worth.
 */
function RowActions({
  prefix,
  what,
  canMoveUp,
  canMoveDown,
  canDelete,
  onUp,
  onDown,
  onDuplicate,
  onDelete,
}: RowActionsProps): React.ReactNode {
  return (
    <span className={styles.rowActions}>
      <button
        className={styles.iconButton}
        aria-label={`Move ${what} up`}
        data-testid={`${prefix}-up`}
        disabled={!canMoveUp}
        onClick={onUp}
      >
        ↑
      </button>
      <button
        className={styles.iconButton}
        aria-label={`Move ${what} down`}
        data-testid={`${prefix}-down`}
        disabled={!canMoveDown}
        onClick={onDown}
      >
        ↓
      </button>
      <button
        className={styles.iconButton}
        aria-label={`Duplicate ${what}`}
        data-testid={`${prefix}-duplicate`}
        onClick={onDuplicate}
      >
        ⧉
      </button>
      <button
        className={clsx(styles.iconButton, styles.buttonDestructive)}
        aria-label={`Delete ${what}`}
        data-testid={`${prefix}-delete`}
        disabled={!canDelete}
        onClick={onDelete}
      >
        ×
      </button>
    </span>
  );
}

// --- The JSON view ---

interface JsonEditorProps {
  text: string;
  result: ReturnType<typeof parseProgramDocument> | null;
  onChange: (text: string) => void;
  onFormat: () => void;
}

/**
 * The document as the device will receive it.
 *
 * The legacy JSON tab was a textarea with line numbers, Prism highlighting and
 * ajv validation. The highlighting and the line numbers went with the 45 KB gz
 * those two libraries cost (D-18); the validation is the same
 * `parseProgramDocument` the rest of the app uses, which reports what the
 * device will change as well as what it will refuse.
 */
function JsonEditor({ text, result, onChange, onFormat }: JsonEditorProps): React.ReactNode {
  return (
    <div className={styles.json}>
      <div className={styles.toolbar}>
        <button className={styles.button} data-testid='editor-json-format' onClick={onFormat}>
          Format
        </button>
        <span className={styles.hint}>
          Applied to the form when the Editor tab is opened, or when the program is saved.
        </span>
      </div>
      <textarea
        className={styles.textarea}
        spellCheck={false}
        aria-label='The program as JSON'
        data-testid='editor-json'
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
      {result && !result.ok && (
        <ul className={clsx(styles.issues, styles.issuesError)} data-testid='editor-json-errors'>
          {issueLines(result.errors).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {result?.ok && result.warnings.length > 0 && (
        <ul className={clsx(styles.issues, styles.issuesWarning)} data-testid='editor-json-warnings'>
          {issueLines(result.warnings).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
