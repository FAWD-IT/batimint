import { cn } from './cn';

export function Logo({ className, inverted = false, name = 'Batimint' }: { className?: string; inverted?: boolean; name?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn(
          'flex size-7 items-center justify-center rounded-[8px] text-[15px] font-bold',
          inverted ? 'bg-white text-[#111111]' : 'bg-ink text-ink-inverse',
        )}
      >
        B
      </span>
      <span className={cn('text-[18px] font-bold tracking-[-0.02em]', inverted ? 'text-white' : 'text-ink')}>{name}</span>
    </span>
  );
}
