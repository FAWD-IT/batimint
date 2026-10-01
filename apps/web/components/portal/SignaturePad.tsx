'use client';

import { Button } from '@batimint/ui';
import { Eraser } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

/**
 * Zone de signature manuscrite (doigt, stylet, souris). Le tracé est transmis en chemin SVG.
 * Facultative : le nom saisi tient lieu de signature pour qui ne peut pas tracer (accessibilité).
 */
export function SignaturePad({ onChange }: { onChange: (path: string | null) => void }) {
  const t = useTranslations('portal.sign');
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<string[]>([]);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      c.width = Math.round(rect.width * ratio);
      c.height = Math.round(rect.height * ratio);
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#111111';
      }
      strokes.current = [];
      onChange(null);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [onChange]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvas}
        role="img"
        aria-label={t('padLabel')}
        className="h-40 w-full touch-none rounded-[12px] border border-line bg-surface"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const p = point(e);
          const ctx = e.currentTarget.getContext('2d');
          ctx?.beginPath();
          ctx?.moveTo(p.x, p.y);
          strokes.current.push(`M${p.x} ${p.y}`);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = point(e);
          const ctx = e.currentTarget.getContext('2d');
          ctx?.lineTo(p.x, p.y);
          ctx?.stroke();
          strokes.current[strokes.current.length - 1] += ` L${p.x} ${p.y}`;
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(strokes.current.join(' ') || null);
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-muted">{t('padHint')}</p>
        <Button
          variant="ghost"
          size="sm"
          icon={<Eraser aria-hidden className="size-4" />}
          onClick={() => {
            const c = canvas.current;
            c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
            strokes.current = [];
            onChange(null);
          }}
        >
          {t('clear')}
        </Button>
      </div>
    </div>
  );
}
