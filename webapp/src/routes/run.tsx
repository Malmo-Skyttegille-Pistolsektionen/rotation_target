import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useProgramsApi } from '../api/programs';
import type { ProgramSummary, StateUpdatePayload } from '../api/types';
import { Timeline } from '../components/Timeline';
import { CountdownModal } from '../components/CountdownModal';
import { useSettings } from '../context/SettingsContext';
import { useAdminStatus } from '../hooks/useAdminStatus';
import styles from './run.module.css';

export const Route = createFileRoute('/run')({
  component: RunView,
});

const PROGRAM_CHANGED_NOTICE =
  'Start cancelled: the device loaded a different program during the countdown. Check the program and start again.';

function programTitle(programs: ProgramSummary[] | undefined, id: number): string {
  return programs?.find((program) => program.id === id)?.title ?? `program ${id}`;
}

/** Exported for the unit tests; the route renders it through `Route`. */
export function RunView(): React.ReactNode {
  const [timelineMode, setTimelineMode] = useState<'auto' | 'default' | 'field'>('auto');
  const [countdown, setCountdown] = useState<number | null>(null);
  // The program the device had loaded when Start was pressed. Non-null only
  // while a countdown is running.
  const [armedProgramId, setArmedProgramId] = useState<number | null>(null);
  // The pick the operator made, until the device's own stateUpdate confirms
  // it. Until then the device still holds the previous program.
  const [pendingProgramId, setPendingProgramId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { settings } = useSettings();
  const { adminModeEnabled } = useAdminStatus();
  const { adminToken } = useSettings();
  const { startDelaySeconds } = settings;
  const programsApi = useProgramsApi();

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
      setPendingProgramId(null);
      setNotice(`Could not load ${programTitle(programs, id)}: ${error.message}`);
    },
  });

  // --- #70: nothing starts unless the device and the operator agree ---------
  //
  // `POST /programs/start` carries no id: it starts whatever the device has
  // loaded at that moment. So the device's `loadedProgramId` is the only thing
  // the UI may act on, and the two moments where it can drift away from what
  // the operator is looking at are settled here, during render, so no state
  // survives the drift.

  // The pick has arrived: the select and the device agree again.
  if (pendingProgramId !== null && pendingProgramId === loadedProgramId) {
    setPendingProgramId(null);
  }

  // The device switched program while the countdown was running - another tab,
  // another client on the range. Cancel it: the countdown was armed for a
  // program that is no longer loaded.
  if (armedProgramId !== null && armedProgramId !== loadedProgramId) {
    setCountdown(null);
    setArmedProgramId(null);
    setNotice(PROGRAM_CHANGED_NOTICE);
  }

  // Start and Reset act on the device's loaded program, so they are offered
  // only once the device has confirmed which one that is.
  const programConfirmed = loadedProgramId != null && pendingProgramId === null;

  const skipToSeriesMutation = useMutation({
    mutationFn: programsApi.skipToSeries,
  });

  // Only `mutate` is ever used, and destructuring it keeps the countdown
  // effect's dependency stable: the object react-query returns is new on every
  // render, so depending on it restarted the timer on every stateUpdate.
  const { mutate: startProgram } = useMutation({
    mutationFn: programsApi.start,
  });

  const stopMutation = useMutation({
    mutationFn: programsApi.stop,
  });

  const resetMutation = useMutation({
    mutationFn: programsApi.reset,
  });

  const toggleTargetsMutation = useMutation({
    mutationFn: programsApi.toggleTargets,
  });

  const handleProgramChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const id = Number(e.target.value);
    if (id) {
      setNotice(null);
      setPendingProgramId(id);
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

  const handleStart = (): void => {
    if (!programConfirmed) return;
    setNotice(null);
    if (startDelaySeconds > 0) {
      // Armed against this program: see the render-phase cancel above.
      setArmedProgramId(loadedProgramId);
      setCountdown(startDelaySeconds);
    } else {
      startProgram();
    }
  };

  const handleCancelCountdown = (): void => closeCountdown();

  const handleStartNow = (): void => {
    closeCountdown();
    startProgram();
  };

  const handlePause = (): void => stopMutation.mutate();
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
      startProgram();
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, startProgram]);

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
                  value={pendingProgramId ?? loadedProgramId ?? ''}
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
