import { useState } from 'react';
import clsx from 'clsx';
import { useSettings } from '../context/SettingsContext';
import { useAdminStatus } from '../hooks/useAdminStatus';
import styles from './AdminModeSection.module.css';

export function AdminModeSection(): React.ReactNode {
  const { adminToken } = useSettings();
  const { adminModeEnabled, isLoading, login, disable, logout, isLoginPending, isDisablePending } = useAdminStatus();
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const isPending = isLoginPending || isDisablePending;
  const isAuthenticated = adminModeEnabled && adminToken !== null;

  const handleEnableOrLogin = async (): Promise<void> => {
    if (!password.trim()) return;

    setLoginError(null);
    try {
      await login(password);
      setPassword('');
    } catch {
      setLoginError('Invalid password');
    }
  };

  const handleDisable = async (): Promise<void> => {
    try {
      await disable();
    } catch {
      // Error handled by mutation
    }
  };

  const handleLogout = (): void => {
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
              onClick={handleEnableOrLogin}
              disabled={!password.trim() || isPending}
            >
              {isPending ? 'Enabling...' : 'Enable Admin Mode'}
            </button>
          </div>
          {loginError && <div className={styles.errorMessage}>{loginError}</div>}
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
              onClick={handleEnableOrLogin}
              disabled={!password.trim() || isPending}
            >
              {isPending ? 'Logging in...' : 'Login as Admin'}
            </button>
          </div>
          <div className={styles.infoText}>Admin controls are hidden. Login to enable them.</div>
          {loginError && <div className={styles.errorMessage}>{loginError}</div>}
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
      </div>
    </section>
  );
}
