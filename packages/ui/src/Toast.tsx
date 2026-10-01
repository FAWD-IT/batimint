'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './cn';

export type ToastTone = 'neutral' | 'good' | 'crit' | 'accent';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Action « Annuler » (08, 02 : chaque action destructrice est annulable pendant 5 s). */
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  show(options: ToastOptions): number;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children, closeLabel }: { children: ReactNode; closeLabel: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback((options: ToastOptions) => {
    const id = ++counter.current;
    setItems((all) => [...all.slice(-3), { ...options, id }]);
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 md:right-6 md:left-auto md:items-end">
        {items.map((t) => (
          <ToastView key={t.id} item={t} onDismiss={() => dismiss(t.id)} closeLabel={closeLabel} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss, closeLabel }: { item: ToastItem; onDismiss: () => void; closeLabel: string }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, item.durationMs ?? (item.action ? 5000 : 4000));
    return () => clearTimeout(timer);
  }, [item, onDismiss]);
  const accent = { neutral: 'bg-white/40', good: 'bg-[#3DBE73]', crit: 'bg-[#EF6B5E]', accent: 'bg-[#7D93FF]' }[item.tone ?? 'neutral'];
  return (
    <div
      role={item.tone === 'crit' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[14px] bg-[#111111] px-4 py-3 text-white motion-safe:animate-[toast-in_180ms_ease-out]"
    >
      <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', accent)} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{item.title}</p>
        {item.description ? <p className="text-[13px] text-[#B8B8B8]">{item.description}</p> : null}
      </div>
      {item.action ? (
        <button
          type="button"
          className="h-8 rounded-[8px] px-2 text-[13px] font-semibold text-[#9DAEFF] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#7D93FF]"
          onClick={() => {
            item.action?.onClick();
            onDismiss();
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onDismiss}
        className="flex size-8 items-center justify-center rounded-[8px] text-[#B8B8B8] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#7D93FF]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé dans <ToastProvider>');
  return ctx;
}
