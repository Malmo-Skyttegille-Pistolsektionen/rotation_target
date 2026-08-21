import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useProgramsApi } from '../api/programs';
import type { ProgramSummary, StateUpdatePayload } from '../api/types';
import { Timeline } from '../components/Timeline';
import { CountdownModal } from '../components/CountdownModal';
import { useSettings } from '../context/SettingsContext';
import { useAdminStatus } from '../hooks/useAdminStatus';
import { unloadFailureNotice } from '../lib/program-notices';
import styles from './run.module.css';

export const Route = createFileRoute('/run')({
  component: RunView,
});

const CONTACT_LOST_NOTICE =
  'Start cancelled: lost contact with the device during the countdown. Check the connection and start again.';

function cancelledNotice(deviceProgramId: number | null): string {
  return deviceProgramId === null
    ? 'Start cancelled: the device unloaded the program during the countdown. Load one and start again.'
    : `Start cancelled: the device loaded program ${deviceProgramId} during the countdown. Check the program and start again.`;
}

function programTitle(programs: ProgramSummary[] | undefined, id: number): string {
  return programs?.find((program) => program.id === id)?.title ?? `program ${id}`;
}

/**
 * May the start go out, for the program it was decided for?
 *
 * Since D-27 the request carries the id, so this is no longer what makes the
 * start safe — the device refuses a stale one itself. It is kept because it
 * explains the refusal in the operator's own terms, before the request goes
 * out and while the countdown is still on screen.
 *
 * Read from the query cache rather than from a render's props: react-query
 * defers subscriber notification through `notifyManager`, so a `stateUpdate`
 * arriving in the last milliseconds of a countdown is already written to the
 * cache while the component still renders the previous one - and a due timer
 * wins that race. `useSSE` writes both of these keys synchronously.
 *
 * Module scope, so the countdown effect can call it without depending on it.
 */
function refuseStart(queryClient: QueryClient, expectedProgramId: number): string | null {
  const latest = queryClient.getQueryData<StateUpdatePayload | null>(['state']);
  const deviceProgramId = latest?.loadedProgramId ?? null;

  if (deviceProgramId !== expectedProgramId) {
    return cancelledNotice(deviceProgramId);
  }

  // A dropped stream means the last state we hold may be minutes old, and the
  // reconnect backoff is longer than a short start delay.
  if (queryClient.getQueryData<string>(['sse-status']) !== 'connected') {
    return CONTACT_LOST_NOTICE;
  }

  return null;
}

/** Exported for the unit tests; the route renders it through `Route`. */
export function RunView(): React.ReactNode {
  const [timelineMode, setTimelineMode] = useState<'auto' | 'default' | 'field'>('auto');
  const [countdown, setCountdown] = useState<number | null>(null);
  // The program the device had loaded when Start was pressed. Non-null only
  // while a countdown is running.
  const [armedProgramId, setArmedProgramId] = useState<number | null>(null);
  // The pick the operator made, together with the program the device held when
  // they made it. Both are needed to recognise the answer: requiring an exact
  // match on the pick wedges Start off whenever two stateUpdates coalesce and
  // the picked id is never observed on its own, and requiring a *change* wedges
  // it when the pick is the program already loaded.
  const [pendingLoad, setPendingLoad] = useState<{ id: number; previousProgramId: number | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { settings } = useSettings();
  const { adminModeEnabled } = useAdminStatus();
  const { adminToken } = useSettings();
  const { startDelaySeconds } = settings;
  const programsApi = useProgramsApi();
  const queryClient = useQueryClient();

  // Check if user can control (admin mode off OR authenticated)
  const isAdminAuthenticated = adminModeEnabled && adminToken !== null;
  const canControl = !adminModeEnabled || isAdminAuthenticated;

  const { data: programs } = useQuery({
    queryKey: ['programs'],
    queryFn: programsApi.list,
  });

  const { data: state } = useQuery<StateUpdatePayload | null>({
    queryKey: ['state'],
    queryFn: async () => null,
    initialData: null,
    enabled: false,
  });

  const loadedProgramId = state?.loadedProgramId ?? null;
  const currentSeriesIndex = state?.programState?.currentSeriesIndex;
  const currentEventIndex = state?.programState?.currentEventIndex;
  const tickerMs = state?.programState?.tickerMs;
  const isRunning = state?.programState?.running ?? false;

  const { data: loadedProgram } = useQuery({
    queryKey: ['program', loadedProgramId],
    queryFn: () => programsApi.get(loadedProgramId!),
    enabled: loadedProgramId != null,
    staleTime: Infinity,
  });

  const activeProgram = loadedProgram ?? null;

  const loadMutation = useMutation({
    mutationFn: programsApi.load,
    onError: (error: Error, id: number) => {
      // Without this Start stays disabled forever, waiting for a confirmation
      // the device is never going to send.
      setPendingLoad(null);
      setNotice(`Could not load ${programTitle(programs, id)}: ${error.message}`);
    },
  });

  // --- #70: nothing starts unless the device and the operator agree ---------
  //
  // The start names its program (D-27), so a stale one is refused by the
  // device. These render-phase settlements are what stop the operator watching
  // a countdown that is already doomed: the device's `loadedProgramId` is the
  // only thing the UI may act on, and the two moments where it can drift away
  // from what the operator is looking at are resolved here, during render, so
  // no state survives the drift.

  // The load has been answered. Anything other than what the device held when
  // the pick was made counts, not the picked id specifically - two coalesced
  // stateUpdates never show the picked id on its own. The second clause is for
  // re-picking the program already loaded, where "something else" never comes.
  if (
    pendingLoad !== null &&
    !loadMutation.isPending &&
    (loadedProgramId !== pendingLoad.previousProgramId || loadedProgramId === pendingLoad.id)
  ) {
    setPendingLoad(null);
  }

  // The device switched program while the countdown was running - another tab,
  // another client on the range. Cancel it: the countdown was armed for a
  // program that is no longer loaded.
  if (armedProgramId !== null && armedProgramId !== loadedProgramId) {
    setCountdown(null);
    setArmedProgramId(null);
    setNotice(cancelledNotice(loadedProgramId));
  }

  // Start and Reset act on the device's loaded program, so they are offered
  // only once the device has confirmed which one that is.
  const programConfirmed = loadedProgramId != null && pendingLoad === null;

  const skipToSeriesMutation = useMutation({
    mutationFn: programsApi.skipToSeries,
  });

  // Only `mutate` is ever used, and destructuring it keeps the countdown
  // effect's dependency stable: the object react-query returns is new on every
  // render, so depending on it restarted the timer on every stateUpdate.
  const { mutate: startProgram } = useMutation({
    mutationFn: programsApi.start,
    // The device's refusal, verbatim: its 409 names the program it actually
    // holds, and that is the fact the operator has to act on.
    onError: (error: Error) => setNotice(error.message),
  });

  const stopMutation = useMutation({
    mutationFn: programsApi.stop,
  });

  const resetMutation = useMutation({
    mutationFn: programsApi.reset,
  });

  // Unloading is run-state bookkeeping, not a library change (D-24 publishes it
  // as a stateUpdate), so it belongs in this control row: the run state it
  // clears is displayed here, and the Pause its 409 asks for is the button
  // beside it.
  const unloadMutation = useMutation({
    mutationFn: programsApi.unload,
    // A 200 says what is true now - not that this call is what made it true.
    onSuccess: () => setNotice('Nothing is loaded on the device now.'),
    onError: (error: Error) => setNotice(unloadFailureNotice(error).message),
  });

  const toggleTargetsMutation = useMutation({
    mutationFn: programsApi.toggleTargets,
  });

  const handleProgramChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const id = Number(e.target.value);
    if (id) {
      setNotice(null);
      setPendingLoad({ id, previousProgramId: loadedProgramId });
      loadMutation.mutate(id);
    }
  };

  const handleSeriesChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const index = Number(e.target.value);
    if (!isNaN(index)) {
      skipToSeriesMutation.mutate(index);
    }
  };

  const closeCountdown = (): void => {
    setCountdown(null);
    setArmedProgramId(null);
  };

  const startIfDeviceAgrees = (expectedProgramId: number | null): void => {
    // Both callers reach here only with a program confirmed loaded. There is no
    // id-less start to fall back to, so a null is dropped rather than sent.
    if (expectedProgramId === null) return;

    const refusal = refuseStart(queryClient, expectedProgramId);
    if (refusal !== null) {
      setNotice(refusal);
      return;
    }
    startProgram(expectedProgramId);
  };

  const handleStart = (): void => {
    if (!programConfirmed) return;
    setNotice(null);
    if (startDelaySeconds > 0) {
      // Armed against this program: see the render-phase cancel above.
      setArmedProgramId(loadedProgramId);
      setCountdown(startDelaySeconds);
    } else {
      startIfDeviceAgrees(loadedProgramId);
    }
  };

  const handleCancelCountdown = (): void => closeCountdown();

  const handleStartNow = (): void => {
    closeCountdown();
    startIfDeviceAgrees(armedProgramId);
  };

  const handlePause = (): void => stopMutation.mutate();
  const handleUnload = (): void => {
    setNotice(null);
    unloadMutation.mutate();
  };
  const handleReset = (): void => resetMutation.mutate();
  const handleToggleTargets = (): void => toggleTargetsMutation.mutate();

  // Countdown timer - one tick a second, then the start.
  useEffect(() => {
    if (countdown === null || countdown <= 0) {
      return;
    }

    const timer = setTimeout(() => {
      if (countdown > 1) {
        setCountdown(countdown - 1);
        return;
      }
      setCountdown(null);
      setArmedProgramId(null);
      if (armedProgramId === null) return;

      const refusal = refuseStart(queryClient, armedProgramId);
      if (refusal !== null) {
        setNotice(refusal);
        return;
      }
      startProgram(armedProgramId);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, armedProgramId, queryClient, startProgram]);

  return (
    <div className={styles.container}>
      <div className={styles.controlBoard}>
        <div className={styles.boardHeader}>
          <div className={styles.headerLeft}>
            <h2 className={styles.title}>Run Program</h2>

            {tickerMs != null && (
              <div className={clsx(styles.infoBadge, styles.badgeTime)}>
                <span className={styles.badgeLabel}>Time:</span>
                {/* Seconds are the client's derivation now - the wire carries ms. */}
                <span className={styles.timerValue} data-testid='run-ticker'>
                  {Math.floor(tickerMs / 1000)}s
                </span>
              </div>
            )}

            <div
              className={clsx(styles.infoBadge, {
                [styles.badgeGreen]: state?.targetStatus === 'shown',
                [styles.badgeRed]: state?.targetStatus === 'hidden',
              })}
            >
              <span className={styles.badgeLabel}>Targets:</span>
              <strong data-testid='run-target-status'>{state?.targetStatus ?? '-'}</strong>
            </div>
          </div>

          <div className={styles.statusDisplay}>
            <span className={styles.statusItem}>
              Program ID: <strong data-testid='run-program-id'>{loadedProgramId ?? '-'}</strong>
            </span>
          </div>
        </div>

        {notice && (
          <div className={styles.notice} data-testid='run-start-notice' role='status'>
            {notice}
          </div>
        )}

        <div className={styles.controlsRow}>
          <div className={styles.inputsGroup}>
            {canControl ? (
              <>
                <select
                  className={styles.select}
                  data-testid='run-program-select'
                  value={pendingLoad?.id ?? loadedProgramId ?? ''}
                  onChange={handleProgramChange}
                  disabled={loadMutation.isPending}
                >
                  <option value='' disabled>
                    Choose program
                  </option>
                  {programs?.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.title} {program.id === loadedProgramId ? '(Loaded)' : ''}
                    </option>
                  ))}
                </select>

                {activeProgram && (
                  <select
                    className={styles.select}
                    value={currentSeriesIndex ?? 0}
                    onChange={handleSeriesChange}
                    disabled={isRunning}
                  >
                    <option value='' disabled>
                      Choose a series
                    </option>
                    {activeProgram.series.map((series, index) => (
                      <option key={index} value={index}>
                        {series.name} {series.optional ? '(optional)' : ''}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  className={styles.select}
                  value={timelineMode}
                  onChange={(e) => setTimelineMode(e.target.value as 'auto' | 'default' | 'field')}
                >
                  <option value='auto'>Timeline: Auto</option>
                  <option value='default'>Timeline: Event-based</option>
                  <option value='field'>Timeline: Time-scaled</option>
                </select>
              </>
            ) : (
              <div className={styles.readOnlyInfo}>
                <div className={styles.readOnlyItem}>
                  <span className={styles.readOnlyLabel}>Program:</span>
                  <span className={styles.readOnlyValue}>
                    {programs?.find((p) => p.id === loadedProgramId)?.title ?? 'None loaded'}
                  </span>
                </div>
                {activeProgram && currentSeriesIndex != null && (
                  <div className={styles.readOnlyItem}>
                    <span className={styles.readOnlyLabel}>Series:</span>
                    <span className={styles.readOnlyValue}>
                      {activeProgram.series[currentSeriesIndex]?.name ?? '-'}
                    </span>
                  </div>
                )}
                <div className={styles.readOnlyItem}>
                  <span className={styles.readOnlyLabel}>Timeline:</span>
                  <span className={styles.readOnlyValue}>
                    {timelineMode === 'auto' ? 'Auto' : timelineMode === 'default' ? 'Event-based' : 'Time-scaled'}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className={styles.actionsGroup}>
            {canControl ? (
              <>
                {!isRunning ? (
                  <button
                    className={clsx(styles.button, styles.buttonStart)}
                    onClick={handleStart}
                    disabled={!programConfirmed}
                  >
                    Start
                  </button>
                ) : (
                  <button className={clsx(styles.button, styles.buttonPause)} onClick={handlePause}>
                    Pause
                  </button>
                )}

                <button
                  className={clsx(styles.button, styles.buttonDestructiveGhost)}
                  onClick={handleReset}
                  disabled={!programConfirmed || isRunning}
                >
                  Reset
                </button>

                {/* Offered while a run is in progress too, rather than
                    disabled: the device is the authority on what is loaded and
                    whether it is running, and its 409 explains the refusal -
                    the escape being the Pause button to the left of it. */}
                <button
                  className={clsx(styles.button, styles.buttonSecondary)}
                  data-testid='run-unload'
                  onClick={handleUnload}
                  disabled={loadedProgramId === null || unloadMutation.isPending}
                >
                  Unload
                </button>

                <button className={clsx(styles.button, styles.buttonSecondary)} onClick={handleToggleTargets}>
                  Toggle Targets
                </button>
              </>
            ) : (
              <div className={styles.viewOnlyBadge} data-testid='run-view-only'>
                <span className={styles.viewOnlyIcon}>👁</span>
                <span>View Only - Login as admin to control</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {activeProgram && (
        <Timeline
          program={activeProgram}
          currentSeriesIndex={currentSeriesIndex ?? null}
          currentEventIndex={currentEventIndex ?? null}
          tickerMs={tickerMs ?? null}
          mode={timelineMode}
        />
      )}

      {countdown !== null && (
        <CountdownModal seconds={countdown} onCancel={handleCancelCountdown} onStartNow={handleStartNow} />
      )}
    </div>
  );
}
