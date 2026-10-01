import type { ReactNode } from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'good' | 'warn' | 'crit' | 'accent' | 'dark';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface border-line text-ink',
  good: 'bg-good-soft border-transparent text-good',
  warn: 'bg-[color-mix(in_srgb,var(--warn)_12%,var(--surface))] border-transparent text-warn',
  crit: 'bg-[color-mix(in_srgb,var(--crit)_10%,var(--surface))] border-transparent text-crit',
  accent: 'bg-accent-soft border-transparent text-accent',
  dark: 'bg-ink border-ink text-ink-inverse',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-muted',
  good: 'bg-good',
  warn: 'bg-warn',
  crit: 'bg-crit',
  accent: 'bg-accent',
  dark: 'bg-ink-inverse',
};

/** Pastille : la couleur porte un état et est toujours doublée d'un libellé (08). */
export function Chip({ tone = 'neutral', dot = false, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium whitespace-nowrap', TONES[tone], className)}>
      {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', DOTS[tone])} /> : null}
      {children}
    </span>
  );
}

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', DOTS[tone], className)} />;
}

/** Indicateur « En direct » : l'accent est réservé au live (08). */
export function LiveIndicator({ label, connected = true, offlineLabel }: { label: string; connected?: boolean; offlineLabel?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] font-semibold" role="status">
      <span className="relative flex size-2">
        {connected ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" /> : null}
        <span className={cn('relative inline-flex size-2 rounded-full', connected ? 'bg-accent' : 'bg-muted')} />
      </span>
      <span className={connected ? 'text-accent' : 'text-muted'}>{connected ? label : (offlineLabel ?? label)}</span>
    </span>
  );
}
