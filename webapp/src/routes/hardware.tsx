import { createFileRoute, Link } from '@tanstack/react-router';
import { HardwareSection } from '../components/HardwareSection';
import styles from './settings.module.css';

/**
 * Expert mode: the hardware a device is configured for (#144).
 *
 * Its own page rather than a section on Settings, and deliberately not in the
 * top navigation. Everything here changes what the device *is* rather than how
 * this browser talks to it, and the failure modes are not recoverable from the
 * page you caused them on:
 *
 *  - A wrong pin drives nothing.
 *  - A wrong hostname changes mDNS, so the device stops answering to the name
 *    everybody uses to reach it. That is worse than a wrong pin: a wrong pin
 *    leaves the web app reachable to fix it from, and a wrong hostname does
 *    not.
 *
 * Reached from a button on Settings. A tab in the main navigation would put it
 * in front of every operator all the time, which is exactly the invitation this
 * page should not extend.
 */
export const Route = createFileRoute('/hardware')({
  component: HardwarePage,
});

function HardwarePage(): React.ReactNode {
  return (
    <div className={styles.container}>
      <Link to='/settings' className={styles.backLink} data-testid='hardware-back'>
        ← Settings
      </Link>
      <h1 className={styles.title}>Expert mode</h1>
      <HardwareSection />
    </div>
  );
}
