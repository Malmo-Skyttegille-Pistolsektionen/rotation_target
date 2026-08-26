import { useState } from 'react';
import clsx from 'clsx';
import { useSettings } from '../context/SettingsContext';
import { useControlLockStatus } from '../hooks/useControlLockStatus';
import styles from './ControlLockSection.module.css';

function getActionErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

export function ControlLockSection(): React.ReactNode {
  const { controlLockToken } = useSettings();
  const {
    controlLockEnabled,
    isLoading,
    enable,
    login,
    disable,
    logout,
    isEnablePending,
    isLoginPending,
    isDisablePending,
  } = useControlLockStatus();
  const [password, setPassword] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const isPending = isEnablePending || isLoginPending || isDisablePending;
  const isAuthenticated = controlLockEnabled && controlLockToken !== null;

  const handleEnable = async (): Promise<void> => {
    if (!password.trim()) {
      return;
    }

    setActionError(null);
    try {
      await enable(password);
      setPassword('');
    } catch (error) {
      setActionError(getActionErrorMessage(error, 'Could not turn the control lock on.'));
    }
  };

  const handleLogin = async (): Promise<void> => {
    if (!password.trim()) {
      return;
    }

    setActionError(null);
    try {
      await login(password);
      setPassword('');
    } catch (error) {
      setActionError(getActionErrorMessage(error, 'Could not log in.'));
    }
  };

  const handleDisable = async (): Promise<void> => {
    setActionError(null);

    try {
      await disable();
    } catch (error) {
      setActionError(getActionErrorMessage(error, 'Could not turn the control lock off.'));
    }
  };

  const handleLogout = (): void => {
    setActionError(null);
    logout();
  };

  if (isLoading) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Control lock</h2>
        <div className={styles.loadingText}>Asking the device…</div>
      </section>
    );
  }

  // State A: the lock is off, and anybody may drive.
  if (!controlLockEnabled) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Control lock</h2>
        <div className={styles.form}>
          <div className={styles.statusRow}>
            <span className={clsx(styles.statusBadge, styles.statusOff)} data-testid='control-lock-status'>
              OFF
            </span>
            <span className={styles.statusDescription}>Full public access — anyone on the network can operate this device</span>
          </div>
          <div className={styles.inputRow}>
            <input
              type='password'
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='Choose a password'
              data-testid='control-lock-password'
            />
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              onClick={handleEnable}
              disabled={!password.trim() || isPending}
            >
              {isPending ? 'Locking…' : 'Turn the lock on'}
            </button>
          </div>
          {actionError && <div className={styles.errorMessage}>{actionError}</div>}
        </div>
      </section>
    );
  }

  // State B: the lock is on and this browser is not holding it.
  if (!isAuthenticated) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Control lock</h2>
        <div className={styles.form}>
          <div className={styles.statusRow}>
            <span className={clsx(styles.statusBadge, styles.statusLocked)} data-testid='control-lock-status'>
              ON 🔒
            </span>
            <span className={styles.statusDescription}>View only — log in to start or change anything</span>
          </div>
          <div className={styles.inputRow}>
            <input
              type='password'
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='Password'
              data-testid='control-lock-password'
            />
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              onClick={handleLogin}
              disabled={!password.trim() || isPending}
            >
              {isLoginPending ? 'Logging in…' : 'Log in'}
            </button>
          </div>
          <div className={styles.infoText}>
            Whoever turned the lock on chose this password. Logging in lets you operate the device; turning the
            lock off returns it to full public access for everyone.
          </div>
          {actionError && <div className={styles.errorMessage}>{actionError}</div>}
        </div>
      </section>
    );
  }

  // State C: the lock is on and this browser is holding it.
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Control lock</h2>
      <div className={styles.form}>
        <div className={styles.statusRow}>
          <span className={clsx(styles.statusBadge, styles.statusActive)} data-testid='control-lock-status'>
            ON ✓
          </span>
          <span className={styles.statusDescription}>You are holding the lock — nobody else can start or change anything</span>
        </div>
        <div className={styles.buttonRow}>
          <button className={clsx(styles.button, styles.buttonSecondary)} onClick={handleLogout} disabled={isPending}>
            Log out
          </button>
          <button
            className={clsx(styles.button, styles.buttonDestructive)}
            onClick={handleDisable}
            disabled={isPending}
          >
            {isPending ? 'Unlocking…' : 'Turn the lock off'}
          </button>
        </div>
        {actionError && <div className={styles.errorMessage}>{actionError}</div>}
      </div>
    </section>
  );
}
