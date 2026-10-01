'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from './Button';
import { cn } from './cn';

interface BaseProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
  className?: string;
}

/**
 * Dialogue modal fondé sur l'élément natif <dialog> : piège de focus, Échap et
 * restauration du focus fournis par le navigateur.
 */
function useNativeDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handler = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('cancel', handler);
    return () => d.removeEventListener('cancel', handler);
  }, [onClose]);
  return ref;
}

function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        aria-hidden
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel,
  className,
}: BaseProps) {
  const ref = useNativeDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'm-auto w-[min(94vw,520px)] rounded-[16px] border border-line bg-surface p-0 text-ink backdrop:bg-black/40',
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-3 px-6 pt-5">
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="text-[17px] font-semibold">
                {title}
              </h2>
              {description ? <div className="text-[14px] text-muted">{description}</div> : null}
            </div>
            <CloseButton onClick={onClose} label={closeLabel} />
          </div>
          <div className="overflow-y-auto px-6 py-4">{children}</div>
          {footer ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft px-6 py-4">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

/** Tiroir latéral pour l'édition rapide sans quitter le contexte (08). */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel,
  className,
}: BaseProps) {
  const ref = useNativeDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'mt-0 mr-0 mb-0 ml-auto h-dvh max-h-dvh w-[min(100vw,480px)] max-w-none rounded-none border-l border-line bg-surface p-0 text-ink backdrop:bg-black/30',
        className,
      )}
    >
      {open ? (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="text-[17px] font-semibold">
                {title}
              </h2>
              {description ? <div className="text-[13px] text-muted">{description}</div> : null}
            </div>
            <CloseButton onClick={onClose} label={closeLabel} />
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft px-5 py-4">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  closeLabel,
  destructive = false,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      closeLabel={closeLabel}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
