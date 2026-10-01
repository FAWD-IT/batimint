'use client';

import { Button } from '@batimint/ui';
import { Mic, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const noopSubscribe = () => () => undefined;
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

/**
 * Enregistrement d'une note vocale (MediaRecorder). Si le micro est refusé ou absent,
 * on propose d'envoyer un fichier audio : la fonction reste utilisable partout.
 */
export function VoiceRecorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (blob: Blob, fileName: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('visit');
  const [state, setState] = useState<'idle' | 'recording' | 'denied'>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => 'MediaRecorder' in window && !!navigator.mediaDevices,
    () => false,
  );

  useEffect(() => {
    if (state !== 'recording') return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => () => recorder.current?.stream.getTracks().forEach((tr) => tr.stop()), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const type = (rec.mimeType || 'audio/webm').split(';')[0]!;
        const blob = new Blob(chunks.current, { type });
        if (blob.size) {
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          onRecorded(
            blob,
            `note-vocale-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`,
          );
        }
        setState('idle');
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setState('recording');
    } catch {
      setState('denied');
    }
  };

  const stop = () => recorder.current?.state === 'recording' && recorder.current.stop();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {state === 'recording' ? (
          <Button variant="danger" icon={<Square aria-hidden className="size-4" />} onClick={stop}>
            {t('stop')}
          </Button>
        ) : supported ? (
          <Button
            variant="secondary"
            icon={<Mic aria-hidden className="size-4" />}
            onClick={() => void start()}
            disabled={disabled}
          >
            {t('record')}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => fileInput.current?.click()} disabled={disabled}>
          {t('uploadAudio')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onRecorded(f, f.name);
            e.target.value = '';
          }}
        />
      </div>
      {state === 'recording' ? (
        <p className="flex items-center gap-2 text-[14px] font-medium text-crit" aria-live="polite">
          <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-crit" />
          {t('recording', { seconds })}
        </p>
      ) : null}
      {state === 'denied' ? (
        <p role="alert" className="text-[13px] text-warn">
          {t('micDenied')}
        </p>
      ) : null}
    </div>
  );
}
