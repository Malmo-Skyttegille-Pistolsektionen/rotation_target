import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { useSettings } from '../context/SettingsContext';
import { fetchAdminStatus, enableAdmin, disableAdmin } from '../api/admin';
import styles from './AdminModeSection.module.css';

export function AdminModeSection(): React.ReactNode {
  const { adminToken, setAdminToken } = useSettings();
  const [adminStatus, setAdminStatus] = useState<'disabled' | 'enabled-mine' | 'enabled-other'>('disabled');
  const [adminLoading, setAdminLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminActionLoading, setAdminActionLoading] = useState(false);

  useEffect(() => {
    async function checkAdminStatus() {
      try {
        setAdminLoading(true);
        const status = await fetchAdminStatus();
        if (status.enabled) {
          setAdminStatus(adminToken ? 'enabled-mine' : 'enabled-other');
        } else {
          setAdminStatus('disabled');
        }
      } catch (error) {
        console.error('[AdminModeSection] Failed to fetch admin status:', error);
        setAdminError('Failed to fetch admin status');
      } finally {
        setAdminLoading(false);
      }
    }

    checkAdminStatus();
  }, [adminToken]);

  const handleAdminEnable = useCallback(async (): Promise<void> => {
    if (!password) {
      return;
    }

    setAdminActionLoading(true);
    setAdminError(null);

    try {
      const response = await enableAdmin(password);
      setAdminToken(response.token);
      setAdminStatus('enabled-mine');
      setPassword('');
    } catch (error) {
      console.error('[AdminModeSection] Failed to enable admin:', error);
      setAdminError('Invalid password or server error');
    } finally {
      setAdminActionLoading(false);
    }
  }, [password, setAdminToken]);

  const handleAdminDisable = useCallback(async (): Promise<void> => {
    if (!adminToken) {
      return;
    }

    setAdminActionLoading(true);
    setAdminError(null);

    try {
      await disableAdmin(adminToken);
      setAdminToken(null);
      setAdminStatus('disabled');
    } catch (error) {
      console.error('[AdminModeSection] Failed to disable admin:', error);
      setAdminError('Failed to disable admin mode');
    } finally {
      setAdminActionLoading(false);
    }
  }, [adminToken, setAdminToken]);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Admin Mode</h2>

      {adminLoading ? (
        <div className={styles.loadingText}>Loading admin status...</div>
      ) : (
        <>
          {adminStatus === 'disabled' && (
            <div className={styles.adminForm}>
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
                  onClick={handleAdminEnable}
                  disabled={!password || adminActionLoading}
                >
                  {adminActionLoading ? 'Enabling...' : 'Enable Admin Mode'}
                </button>
              </div>
              <div className={clsx(styles.statusText, styles.statusGray)}>Admin mode is disabled.</div>
            </div>
          )}

          {adminStatus === 'enabled-mine' && (
            <div className={styles.adminForm}>
              <button
                className={clsx(styles.button, styles.buttonDestructive)}
                onClick={handleAdminDisable}
                disabled={adminActionLoading}
              >
                {adminActionLoading ? 'Disabling...' : 'Disable Admin Mode'}
              </button>
              <div className={clsx(styles.statusText, styles.statusGreen)}>Admin mode is enabled.</div>
            </div>
          )}

          {adminStatus === 'enabled-other' && (
            <div className={styles.adminForm}>
              <div className={clsx(styles.statusText, styles.statusOrange)}>
                Admin mode is enabled (by another client).
              </div>
            </div>
          )}

          {adminError && <div className={styles.errorMessage}>{adminError}</div>}
        </>
      )}
    </section>
  );
}
