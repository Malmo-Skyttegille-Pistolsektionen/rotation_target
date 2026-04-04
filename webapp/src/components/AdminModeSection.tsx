import { useState } from 'react';
import clsx from 'clsx';
import { useSettings } from '../context/SettingsContext';
import { useAdminStatus } from '../hooks/useAdminStatus';
import styles from './AdminModeSection.module.css';

function getActionErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

export function AdminModeSection(): React.ReactNode {
  const { adminToken } = useSettings();
  const {
    adminModeEnabled,
    isLoading,
    enable,
    login,
    disable,
    logout,
    isEnablePending,
    isLoginPending,
    isDisablePending,
  } = useAdminStatus();
  const [password, setPassword] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const isPending = isEnablePending || isLoginPending || isDisablePending;
  const isAuthenticated = adminModeEnabled && adminToken !== null;

  const handleEnable = async (): Promise<void> => {
    if (!password.trim()) {
      return;
    }

    setActionError(null);
    try {
      await enable(password);
      setPassword('');
    } catch (error) {
      setActionError(getActionErrorMessage(error, 'Failed to enable admin mode.'));
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
      setActionError(getActionErrorMessage(error, 'Failed to log in as admin.'));
    }
  };

  const handleDisable = async (): Promise<void> => {
    setActionError(null);

    try {
      await disable();
    } catch (error) {
      setActionError(getActionErrorMessage(error, 'Failed to disable admin mode.'));
    }
  };

  const handleLogout = (): void => {
    setActionError(null);
    logout();
  };

  if (isLoading) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Admin Mode</h2>
        <div className={styles.loadingText}>Loading admin status...</div>
      </section>
    );
  }

  // State A: Admin Mode OFF
  if (!adminModeEnabled) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Admin Mode</h2>
        <div className={styles.adminForm}>
          <div className={styles.statusRow}>
            <span className={clsx(styles.statusBadge, styles.statusOff)}>OFF</span>
            <span className={styles.statusDescription}>Full public access - anyone can control</span>
          </div>
          <div className={styles.inputRow}>
            <input
              type='password'
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='Enter admin password to enable'
            />
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              onClick={handleEnable}
              disabled={!password.trim() || isPending}
            >
              {isPending ? 'Enabling...' : 'Enable Admin Mode'}
            </button>
          </div>
          {actionError && <div className={styles.errorMessage}>{actionError}</div>}
        </div>
      </section>
    );
  }

  // State B: Admin Mode ON, Not Authenticated
  if (!isAuthenticated) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Admin Mode</h2>
        <div className={styles.adminForm}>
          <div className={styles.statusRow}>
            <span className={clsx(styles.statusBadge, styles.statusLocked)}>ON 🔒</span>
            <span className={styles.statusDescription}>View only - login required to control</span>
          </div>
          <div className={styles.inputRow}>
            <input
              type='password'
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='Enter admin password'
            />
            <button
              className={clsx(styles.button, styles.buttonPrimary)}
              onClick={handleLogin}
              disabled={!password.trim() || isPending}
            >
              {isLoginPending ? 'Logging in...' : 'Login as Admin'}
            </button>
          </div>
          <div className={styles.infoText}>Login to control the app or disable admin mode.</div>
          {actionError && <div className={styles.errorMessage}>{actionError}</div>}
        </div>
      </section>
    );
  }

  // State C: Admin Mode ON, Authenticated
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Admin Mode</h2>
      <div className={styles.adminForm}>
        <div className={styles.statusRow}>
          <span className={clsx(styles.statusBadge, styles.statusActive)}>ON ✓</span>
          <span className={styles.statusDescription}>You have full admin access</span>
        </div>
        <div className={styles.buttonRow}>
          <button className={clsx(styles.button, styles.buttonSecondary)} onClick={handleLogout} disabled={isPending}>
            Logout
          </button>
          <button
            className={clsx(styles.button, styles.buttonDestructive)}
            onClick={handleDisable}
            disabled={isPending}
          >
            {isPending ? 'Disabling...' : 'Disable Admin Mode'}
          </button>
        </div>
        {actionError && <div className={styles.errorMessage}>{actionError}</div>}
      </div>
    </section>
  );
}
