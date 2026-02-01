import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { programsApi } from '../api/programs';
import type { StateUpdatePayload } from '../api/types';
import { Timeline } from '../components/Timeline';
import { CountdownModal } from '../components/CountdownModal';
import { useSettings } from '../context/SettingsContext';
import styles from './run.module.css';

export const Route = createFileRoute('/run')({
  component: RunView,
});

function RunView(): React.ReactNode {
  const [timelineMode, setTimelineMode] = useState<'auto' | 'default' | 'field'>('auto');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showCountdownModal, setShowCountdownModal] = useState(false);
  const { settings } = useSettings();
  const { startDelaySeconds } = settings;
  const countdownRef = useRef<number | null>(null);

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
  const tickerSeconds = state?.programState?.tickerSeconds;
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
  });

  const skipToSeriesMutation = useMutation({
    mutationFn: programsApi.skipToSeries,
  });

  const startMutation = useMutation({
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
      loadMutation.mutate(id);
    }
  };

  const handleSeriesChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const index = Number(e.target.value);
    if (!isNaN(index)) {
      skipToSeriesMutation.mutate(index);
    }
  };

  const handleStart = (): void => {
    if (startDelaySeconds > 0) {
      countdownRef.current = startDelaySeconds;
      setCountdown(startDelaySeconds);
      setShowCountdownModal(true);
    } else {
      startMutation.mutate();
    }
  };

  const handleCancelCountdown = (): void => {
    setShowCountdownModal(false);
    setCountdown(null);
    countdownRef.current = null;
  };

  const handleStartNow = (): void => {
    setShowCountdownModal(false);
    setCountdown(null);
    countdownRef.current = null;
    startMutation.mutate();
  };

  const handlePause = (): void => stopMutation.mutate();
  const handleReset = (): void => resetMutation.mutate();
  const handleToggleTargets = (): void => toggleTargetsMutation.mutate();

  // Countdown timer effect - handles timer tick and completion
  useEffect(() => {
    if (!showCountdownModal || countdown === null) {
      return;
    }

    if (countdown <= 0) {
      // Completion is handled by the timer callback when it reaches 0
      return;
    }

    const timer = setTimeout(() => {
      const newValue = countdown - 1;
      countdownRef.current = newValue;

      if (newValue <= 0) {
        // Handle completion - countdown reached 0
        setShowCountdownModal(false);
        setCountdown(null);
        countdownRef.current = null;
        startMutation.mutate();
      } else {
        setCountdown(newValue);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, showCountdownModal, startMutation]);

  return (
    <div className={styles.container}>
      <div className={styles.controlBoard}>
        <div className={styles.boardHeader}>
          <div className={styles.headerLeft}>
            <h2 className={styles.title}>Run Program</h2>

            {tickerSeconds != null && (
              <div className={clsx(styles.infoBadge, styles.badgeTime)}>
                <span className={styles.badgeLabel}>Time:</span>
                <span className={styles.timerValue}>{tickerSeconds}s</span>
              </div>
            )}

            <div
              className={clsx(styles.infoBadge, {
                [styles.badgeGreen]: state?.targetStatus === 'shown',
                [styles.badgeRed]: state?.targetStatus === 'hidden',
              })}
            >
              <span className={styles.badgeLabel}>Targets:</span>
              <strong>{state?.targetStatus ?? '-'}</strong>
            </div>
          </div>

          <div className={styles.statusDisplay}>
            <span className={styles.statusItem}>
              Program ID: <strong>{loadedProgramId ?? '-'}</strong>
            </span>
          </div>
        </div>

        <div className={styles.controlsRow}>
          <div className={styles.inputsGroup}>
            <select
              className={styles.select}
              value={loadedProgramId ?? ''}
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
          </div>

          <div className={styles.actionsGroup}>
            {!isRunning ? (
              <button
                className={clsx(styles.button, styles.buttonStart)}
                onClick={handleStart}
                disabled={!loadedProgramId}
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
              disabled={!loadedProgramId || isRunning}
            >
              Reset
            </button>

            <button className={clsx(styles.button, styles.buttonSecondary)} onClick={handleToggleTargets}>
              Toggle Targets
            </button>
          </div>
        </div>
      </div>

      {activeProgram && (
        <Timeline
          program={activeProgram}
          currentSeriesIndex={currentSeriesIndex ?? null}
          currentEventIndex={currentEventIndex ?? null}
          tickerSeconds={tickerSeconds ?? null}
          mode={timelineMode}
        />
      )}

      {showCountdownModal && countdown !== null && (
        <CountdownModal seconds={countdown} onCancel={handleCancelCountdown} onStartNow={handleStartNow} />
      )}
    </div>
  );
}
