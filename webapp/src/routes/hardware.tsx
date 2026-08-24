import { createFileRoute, Link } from '@tanstack/react-router';
import { HardwareSection } from '../components/HardwareSection';
import { useConfigWindow } from '../hooks/useConfigWindow';
import styles from './settings.module.css';

/**
 * Expert mode: the hardware a device is configured for (#144).
 *
 * Its own page rather than a section on Settings, and reachable only while the
 * device's configuration window is open. Everything here changes what the
 * device *is* rather than how this browser talks to it, and the failure modes
 * are not recoverable from the page that caused them:
 *
 *  - A wrong pin drives nothing.
 *  - A wrong hostname changes mDNS, so the device stops answering to the name
 *    everybody uses to reach it. Worse than a wrong pin, which at least leaves
 *    the web app reachable to fix it from.
 */
export const Route = createFileRoute('/hardware')({
  component: HardwarePage,
});

function HardwarePage(): React.ReactNode {
  const { open, remainingSeconds } = useConfigWindow();

  return (
    <div className={styles.container}>
      <Link to='/settings' className={styles.backLink} data-testid='hardware-back'>
        ← Settings
      </Link>
      <h1 className={styles.title}>Expert mode</h1>

      {/* The countdown lives here rather than in the tab: it answers "how long
          have I got", which is a question asked while typing a pin number, not
          while looking at the navigation. */}
      {open ? (
        <p className={styles.window} data-testid='config-window'>
          Configuration is unlocked for <strong>{formatRemaining(remainingSeconds)}</strong>. Press
          the device&rsquo;s <strong>BOOT</strong> button three times again for a fresh five
          minutes.
        </p>
      ) : (
        <p className={styles.windowShut} data-testid='config-window-shut'>
          Configuration is <strong>locked</strong>. Press the <strong>BOOT</strong> button on the
          device <strong>three times within ten seconds</strong> &mdash; it is next to the USB
          sockets, marked <code>BOOT</code> or <code>FLASH</code> &mdash; to unlock it for five
          minutes. Three rather than one so it cannot happen by accident.
        </p>
      )}

      <HardwareSection />
    </div>
  );
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes)}:${String(rest).padStart(2, '0')}`;
}
