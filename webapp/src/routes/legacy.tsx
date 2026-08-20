import { createFileRoute } from '@tanstack/react-router';
import styles from './legacy.module.css';

export const Route = createFileRoute('/legacy')({
  component: Legacy,
});

function Legacy() {
  return <iframe src='/legacy.html' title='Legacy Application' className={styles.frame} />;
}
