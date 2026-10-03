'use client';

import type { ReceptionDto } from '@batimint/contracts';
import { Button, Checkbox, Dialog, Notice, SelectField, TextAreaField, TextField, useToast } from '@batimint/ui';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { SignaturePad } from '@/components/portal/SignaturePad';
import { api } from '@/lib/api';
import { compressImage, uploadRaw } from '@/lib/upload';
import { useErrorMessage } from '@/lib/use-error-message';

interface Reserve {
  id: string;
  description: string;
  location: string;
  budgetLineId: string;
  photos: { id: string; preview: string }[];
}

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/**
 * PV de réception (P10.1) : réserves décrites et photographiées sur place, puis signature du
 * client sur l'écran. La signature demande du réseau : le PV signé est produit par le serveur.
 * Utilisé sur le téléphone (vue terrain) comme au bureau ; le PV définitif n'a pas de réserves.
 */
export function ReceptionSheet({
  kind,
  projectId,
  customerName,
  posts,
  online = true,
  onClose,
  onSigned,
}: {
  kind: 'provisional' | 'final';
  projectId: string;
  customerName: string;
  posts: { id: string; label: string }[];
  online?: boolean;
  onClose: () => void;
  onSigned: (r: ReceptionDto) => void;
}) {
  const t = useTranslations('reception.sheet');
  const tc = useTranslations('common');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [id] = useState(() => uuidv7());
  const [step, setStep] = useState<'describe' | 'sign'>('describe');
  const [date, setDate] = useState(today);
  const [attendees, setAttendees] = useState('');
  const [notes, setNotes] = useState('');
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [signer, setSigner] = useState(customerName);
  const [accept, setAccept] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoFor = useRef<string | null>(null);

  const update = (rid: string, patch: Partial<Reserve>) =>
    setReserves((all) => all.map((r) => (r.id === rid ? { ...r, ...patch } : r)));

  const addPhotos = async (rid: string, files: File[]) => {
    setUploading(rid);
    try {
      for (const file of files) {
        const blob = await compressImage(file);
        const photoId = uuidv7();
        const params = new URLSearchParams({
          ownerType: 'project',
          ownerId: projectId,
          kind: 'photo',
          id: photoId,
          takenAt: new Date().toISOString(),
          caption: t('photoCaption'),
        });
        await uploadRaw(`/attachments?${params.toString()}`, blob, {
          fileName: file.name || 'reserve.jpg',
          contentType: blob.type || 'image/jpeg',
        });
        const preview = URL.createObjectURL(blob);
        setReserves((all) =>
          all.map((r) => (r.id === rid ? { ...r, photos: [...r.photos, { id: photoId, preview }] } : r)),
        );
      }
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setUploading(null);
    }
  };

  const toSign = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    reserves.forEach((r, k) => {
      if (r.description.trim().length < 3) errs[`reserve-${r.id}`] = t('reserveRequired', { n: k + 1 });
    });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!online) return setErrors({ form: t('needsNetwork') });
    setPending(true);
    try {
      await api<ReceptionDto>(`/projects/${projectId}/receptions/${id}`, {
        method: 'PUT',
        body: {
          kind,
          receptionDate: date,
          attendees: attendees.trim() || null,
          notes: notes.trim() || null,
          reserves: reserves.map((r) => ({
            id: r.id,
            description: r.description.trim(),
            location: r.location.trim() || null,
            budgetLineId: r.budgetLineId || null,
            photoIds: r.photos.map((p) => p.id),
          })),
        },
      });
      setStep('sign');
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  const sign = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (signer.trim().length < 2) errs['signer'] = t('signerRequired');
    if (!accept) errs['accept'] = t('acceptRequired');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!online) return setErrors({ form: t('needsNetwork') });
    setPending(true);
    try {
      const r = await api<ReceptionDto>(`/receptions/${id}/sign`, {
        method: 'POST',
        body: { signerName: signer.trim(), acceptTerms: true, signaturePath: path },
      });
      toast.show({ title: t('signed', { number: r.number ?? '' }), tone: 'good' });
      onSigned(r);
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  const title = kind === 'provisional' ? t('provisionalTitle') : t('finalTitle');
  return (
    <Dialog
      open
      onClose={onClose}
      title={step === 'describe' ? title : t('signTitle')}
      description={step === 'describe' ? t(`${kind}Subtitle`) : t('signSubtitle', { name: customerName })}
      closeLabel={tc('close')}
      className="w-[min(96vw,620px)]"
      footer={
        step === 'describe' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" form={`reception-${id}`} loading={pending} size="lg">
              {t('toSign')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setStep('describe')}>
              {tc('back')}
            </Button>
            <Button type="submit" form={`reception-sign-${id}`} loading={pending} size="lg" variant="accent">
              {t('sign')}
            </Button>
          </>
        )
      }
    >
      {errors['form'] ? (
        <div className="mb-3">
          <Notice tone="crit">{errors['form']}</Notice>
        </div>
      ) : null}
      {step === 'describe' ? (
        <form id={`reception-${id}`} onSubmit={(e) => void toSign(e)} className="flex flex-col gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <TextField
              label={t('attendees')}
              value={attendees}
              placeholder={t('attendeesPlaceholder')}
              optionalLabel={tc('optional')}
              onChange={(e) => setAttendees(e.target.value)}
            />
          </div>
          {kind === 'provisional' ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-[15px] font-semibold">{t('reserves')}</legend>
              {reserves.length === 0 ? <p className="text-[14px] text-muted">{t('noReserve')}</p> : null}
              {reserves.map((r, k) => (
                <div key={r.id} className="flex flex-col gap-3 rounded-[14px] border border-line p-3" data-testid="reserve">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-semibold">{t('reserveN', { n: k + 1 })}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('removeReserve', { n: k + 1 })}
                      icon={<Trash2 aria-hidden className="size-4" />}
                      onClick={() => setReserves((all) => all.filter((x) => x.id !== r.id))}
                    />
                  </div>
                  <TextAreaField
                    label={t('reserveDescription', { n: k + 1 })}
                    value={r.description}
                    rows={2}
                    placeholder={t('reservePlaceholder')}
                    error={errors[`reserve-${r.id}`]}
                    onChange={(e) => update(r.id, { description: e.target.value })}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField
                      label={t('location', { n: k + 1 })}
                      value={r.location}
                      placeholder={t('locationPlaceholder')}
                      optionalLabel={tc('optional')}
                      onChange={(e) => update(r.id, { location: e.target.value })}
                    />
                    {posts.length ? (
                      <SelectField
                        label={t('post', { n: k + 1 })}
                        value={r.budgetLineId}
                        onChange={(e) => update(r.id, { budgetLineId: e.target.value })}
                        options={[{ value: '', label: t('noPost') }, ...posts.map((p) => ({ value: p.id, label: p.label }))]}
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.photos.map((p) => (
                      <img key={p.id} src={p.preview} alt={t('photoAlt', { n: k + 1 })} className="size-16 rounded-[10px] object-cover" />
                    ))}
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Camera aria-hidden className="size-4" />}
                      loading={uploading === r.id}
                      disabled={!online}
                      onClick={() => {
                        photoFor.current = r.id;
                        fileInput.current?.click();
                      }}
                    >
                      {t('addPhoto', { n: k + 1 })}
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="secondary"
                className="w-fit"
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() =>
                  setReserves((all) => [
                    ...all,
                    { id: uuidv7(), description: '', location: '', budgetLineId: '', photos: [] },
                  ])
                }
              >
                {t('addReserve')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                data-testid="reserve-photo-input"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length && photoFor.current) void addPhotos(photoFor.current, files);
                }}
              />
            </fieldset>
          ) : null}
          <TextAreaField
            label={t('notes')}
            value={notes}
            rows={2}
            optionalLabel={tc('optional')}
            onChange={(e) => setNotes(e.target.value)}
          />
        </form>
      ) : (
        <form id={`reception-sign-${id}`} onSubmit={(e) => void sign(e)} className="flex flex-col gap-4" noValidate>
          <Notice tone="accent">
            {kind === 'provisional'
              ? reserves.length
                ? t('summaryReserves', { n: reserves.length })
                : t('summaryNoReserve')
              : t('summaryFinal')}
          </Notice>
          <TextField
            label={t('signer')}
            value={signer}
            error={errors['signer']}
            onChange={(e) => setSigner(e.target.value)}
            autoComplete="off"
          />
          <SignaturePad onChange={setPath} />
          <div>
            <Checkbox
              label={kind === 'provisional' ? t('acceptProvisional') : t('acceptFinal')}
              checked={accept}
              onChange={(e) => setAccept(e.target.checked)}
            />
            {errors['accept'] ? (
              <p role="alert" className="text-[13px] text-crit">
                {errors['accept']}
              </p>
            ) : null}
          </div>
        </form>
      )}
    </Dialog>
  );
}
