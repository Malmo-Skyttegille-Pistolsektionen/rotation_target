import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';
import { initializeBaseUrl } from '../api/client';
import { ServerUrlSection } from '../components/ServerUrlSection';
import { AdminModeSection } from '../components/AdminModeSection';
import { StartDelaySection } from '../components/StartDelaySection';
import styles from './settings.module.css';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage(): React.ReactNode {
  const { settings } = useSettings();

  // Initialize base URL on mount - only run once on initial mount
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      initializeBaseUrl(settings.serverBaseUrl);
    }
  }, [settings.serverBaseUrl]);

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Settings</h1>

      <ServerUrlSection />

      <AdminModeSection />

      <StartDelaySection />
    </div>
  );
}
