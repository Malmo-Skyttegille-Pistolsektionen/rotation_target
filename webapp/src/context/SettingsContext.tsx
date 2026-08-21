import { createContext, use, useState, useEffect } from 'react';

const STORAGE_PREFIX = 'rt_settings_';
const STORAGE_KEYS = {
  serverBaseUrl: `${STORAGE_PREFIX}server_base_url`,
  startDelaySeconds: `${STORAGE_PREFIX}start_delay_seconds`,
  adminToken: `${STORAGE_PREFIX}admin_token`,
} as const;

import { DEFAULT_BASE_URL } from '../api/base-url';

const DEFAULT_VALUES = {
  // Same-origin by default - see DEFAULT_BASE_URL. A value in localStorage,
  // set on the settings page, still wins.
  serverBaseUrl: DEFAULT_BASE_URL,
  startDelaySeconds: 10,
} as const;

/**
 * Seconds the run page counts down before it starts the program. `0` is a
 * value, not the absence of one: it means start at once, which is the branch
 * `run.tsx` has always had for it.
 */
export const START_DELAY_MIN_SECONDS = 0;
export const START_DELAY_MAX_SECONDS = 60;

/** The one place the range is enforced - every writer and the reader go through it. */
function clampStartDelaySeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return DEFAULT_VALUES.startDelaySeconds;
  }
  return Math.min(START_DELAY_MAX_SECONDS, Math.max(START_DELAY_MIN_SECONDS, Math.round(seconds)));
}

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
  logoutAdmin: () => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function useSettings(): SettingsContextType {
  const context = use(SettingsContext);
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
      startDelaySeconds:
        storedDelay === null ? DEFAULT_VALUES.startDelaySeconds : clampStartDelaySeconds(Number(storedDelay)),
    };
  });

  // Not `setAdminToken`: that name belongs to the context method below, which
  // wraps this setter with the localStorage write.
  // eslint-disable-next-line @eslint-react/use-state
  const [adminToken, setAdminTokenState] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return localStorage.getItem(STORAGE_KEYS.adminToken);
  });

  function setServerBaseUrl(url: string): void {
    localStorage.setItem(STORAGE_KEYS.serverBaseUrl, url);
    setSettings((prev) => ({ ...prev, serverBaseUrl: url }));
  }

  function setStartDelaySeconds(seconds: number): void {
    const validSeconds = clampStartDelaySeconds(seconds);
    localStorage.setItem(STORAGE_KEYS.startDelaySeconds, String(validSeconds));
    setSettings((prev) => ({ ...prev, startDelaySeconds: validSeconds }));
  }

  function setAdminToken(token: string | null): void {
    if (token) {
      localStorage.setItem(STORAGE_KEYS.adminToken, token);
    } else {
      localStorage.removeItem(STORAGE_KEYS.adminToken);
    }
    setAdminTokenState(token);
  }

  function logoutAdmin(): void {
    localStorage.removeItem(STORAGE_KEYS.adminToken);
    setAdminTokenState(null);
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleStorageChange = (e: StorageEvent): void => {
      if (e.key === STORAGE_KEYS.serverBaseUrl && e.newValue) {
        setSettings((prev) => ({ ...prev, serverBaseUrl: e.newValue! }));
      } else if (e.key === STORAGE_KEYS.startDelaySeconds && e.newValue) {
        setSettings((prev) => ({ ...prev, startDelaySeconds: clampStartDelaySeconds(Number(e.newValue)) }));
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
    logoutAdmin,
  };

  return <SettingsContext value={value}>{children}</SettingsContext>;
}
