import { cn } from './cn';

export type GaugeTone = 'ink' | 'warn' | 'accent' | 'good' | 'crit';

const FILL: Record<GaugeTone, string> = {
  ink: 'bg-ink',
  warn: 'bg-warn',
  accent: 'bg-accent',
  good: 'bg-good',
  crit: 'bg-crit',
};

/** Jauge (08) : piste --line, remplissage selon l'état. value entre 0 et 1 (peut dépasser 1). */
export function Gauge({
  value,
  tone = 'ink',
  label,
  className,
  height = 8,
}: {
  value: number;
  tone?: GaugeTone;
  label: string;
  className?: string;
  height?: 6 | 8;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className={cn('w-full overflow-hidden rounded-full bg-line', height === 6 ? 'h-1.5' : 'h-2', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-[180ms] ease-out', FILL[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Barre d'étapes du chantier (08) : 5 segments ; le segment en cours est rempli en accent
 * au prorata de l'avancement.
 */
export function StepBar({
  steps,
  current,
  progress,
  label,
}: {
  steps: string[];
  current: number;
  progress: number;
  label: string;
}) {
  return (
    <div aria-label={label} role="group" className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        {steps.map((s, i) => (
          <div key={s} className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <div
              className={cn('h-full rounded-full', i < current ? 'bg-ink' : i === current ? 'bg-accent' : '')}
              style={{
                width:
                  i < current
                    ? '100%'
                    : i === current
                      ? `${Math.max(0, Math.min(1, progress)) * 100}%`
                      : '0%',
              }}
            />
          </div>
        ))}
      </div>
      <ol className="flex gap-1.5">
        {steps.map((s, i) => (
          <li
            key={s}
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'flex-1 truncate text-[12px]',
              i === current ? 'font-semibold text-ink' : i < current ? 'text-ink' : 'text-muted',
            )}
          >
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}
