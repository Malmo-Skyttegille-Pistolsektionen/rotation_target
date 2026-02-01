import { useState, useCallback } from 'react';
import clsx from 'clsx';
import { useSettings } from '../context/SettingsContext';
import { updateBaseUrl } from '../api/client';
import styles from './ServerUrlSection.module.css';

function isUrlValid(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (parsed.hostname === 'localhost') return true;
    if (/(^(\d{1,3}\.){3}\d{1,3}$)/.test(parsed.hostname)) {
      return parsed.hostname.split('.').every((part) => {
        const n = Number(part);
        return n >= 0 && n <= 255;
      });
    }
    return /^[a-zA-Z0-9.-]+$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function ServerUrlSection(): React.ReactNode {
  const { settings, setServerBaseUrl } = useSettings();
  const [urlInput, setUrlInput] = useState(settings.serverBaseUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlSuccess, setUrlSuccess] = useState(false);

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value;
    setUrlInput(value);
    setUrlSuccess(false);

    if (!isUrlValid(value)) {
      setUrlError('Please enter a valid URL (e.g., http://localhost:8080)');
    } else {
      setUrlError(null);
    }
  }, []);

  const handleUrlSave = useCallback(async (): Promise<void> => {
    if (!isUrlValid(urlInput)) {
      return;
    }

    setServerBaseUrl(urlInput);
    updateBaseUrl(urlInput);
    setUrlSuccess(true);

    setTimeout(() => {
      setUrlSuccess(false);
    }, 3000);
  }, [urlInput, setServerBaseUrl]);

  const urlChanged = urlInput !== settings.serverBaseUrl;
  const urlValid = isUrlValid(urlInput);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Server Base URL</h2>
      <div className={styles.inputRow}>
        <input
          type='url'
          className={clsx(styles.input, urlError && styles.inputError)}
          value={urlInput}
          onChange={handleUrlChange}
          placeholder='http://localhost:8080'
        />
        <button
          className={clsx(styles.button, styles.buttonPrimary)}
          onClick={handleUrlSave}
          disabled={!urlValid || !urlChanged}
        >
          Save
        </button>
      </div>
      {urlError && <div className={styles.errorMessage}>{urlError}</div>}
      {urlSuccess && <div className={styles.successMessage}>Server URL saved successfully</div>}
    </section>
  );
}
