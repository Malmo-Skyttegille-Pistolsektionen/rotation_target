import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_PREFIX = 'rt_settings_';
const STORAGE_KEYS = {
  serverBaseUrl: `${STORAGE_PREFIX}server_base_url`,
  startDelaySeconds: `${STORAGE_PREFIX}start_delay_seconds`,
  adminToken: `${STORAGE_PREFIX}admin_token`,
} as const;

const DEFAULT_VALUES = {
  serverBaseUrl: 'http://localhost:8080',
  startDelaySeconds: 10,
} as const;

export interface Settings {
  serverBaseUrl: string;
  startDelaySeconds: number;
}

export interface SettingsContextType {
  settings: Settings;
  adminToken: string | null;
  setServerBaseUrl: (url: string) => void;
  setStartDelaySeconds: (seconds: number) => void;
  setAdminToken: (token: string | null) => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function useSettings(): SettingsContextType {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

export function SettingsProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [settings, setSettings] = useState<Settings>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_VALUES;
    }

    const storedUrl = localStorage.getItem(STORAGE_KEYS.serverBaseUrl);
    const storedDelay = localStorage.getItem(STORAGE_KEYS.startDelaySeconds);

    return {
      serverBaseUrl: storedUrl ?? DEFAULT_VALUES.serverBaseUrl,
      startDelaySeconds: storedDelay ? Number(storedDelay) : DEFAULT_VALUES.startDelaySeconds,
    };
  });

  const [adminToken, setAdminTokenState] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return localStorage.getItem(STORAGE_KEYS.adminToken);
  });

  const setServerBaseUrl = useCallback((url: string): void => {
    localStorage.setItem(STORAGE_KEYS.serverBaseUrl, url);
    setSettings((prev) => ({ ...prev, serverBaseUrl: url }));
  }, []);

  const setStartDelaySeconds = useCallback((seconds: number): void => {
    const validSeconds = Math.max(1, Math.min(60, seconds));
    localStorage.setItem(STORAGE_KEYS.startDelaySeconds, String(validSeconds));
    setSettings((prev) => ({ ...prev, startDelaySeconds: validSeconds }));
  }, []);

  const setAdminToken = useCallback((token: string | null): void => {
    if (token) {
      localStorage.setItem(STORAGE_KEYS.adminToken, token);
    } else {
      localStorage.removeItem(STORAGE_KEYS.adminToken);
    }
    setAdminTokenState(token);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleStorageChange = (e: StorageEvent): void => {
      if (e.key === STORAGE_KEYS.serverBaseUrl && e.newValue) {
        setSettings((prev) => ({ ...prev, serverBaseUrl: e.newValue! }));
      } else if (e.key === STORAGE_KEYS.startDelaySeconds && e.newValue) {
        setSettings((prev) => ({ ...prev, startDelaySeconds: Number(e.newValue) }));
      } else if (e.key === STORAGE_KEYS.adminToken) {
        setAdminTokenState(e.newValue);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const value: SettingsContextType = {
    settings,
    adminToken,
    setServerBaseUrl,
    setStartDelaySeconds,
    setAdminToken,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
