import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * What `window.confirm()` was doing in the legacy tab, minus the part where it
 * blocks the whole browser and cannot say which program it is about.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactNode {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal?.();

    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      data-testid='confirm-dialog'
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className={styles.content}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.body}>{body}</div>
        <div className={styles.buttonRow}>
          <button className={styles.button} onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button
            className={clsx(styles.button, destructive ? styles.buttonDestructive : styles.buttonPrimary)}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
