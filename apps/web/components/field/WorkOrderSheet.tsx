'use client';

import type { WorkOrderDto } from '@batimint/contracts';
import { Button, Checkbox, Dialog, Notice, TextAreaField, TextField, useToast } from '@batimint/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { SignaturePad } from '@/components/portal/SignaturePad';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';
import { useField } from './FieldProvider';

interface Line {
  key: string;
  kind: 'labour' | 'material';
  description: string;
  quantity: string;
  unit: string;
  employeeId: string | null;
}

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** « 2,5 » → « 2.5 » ; vide ou invalide → null. */
function parseQuantity(v: string): string | null {
  const s = v.replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d{1,3})?$/.test(s) && Number(s) > 0 ? s : null;
}

/**
 * Bon de régie (02 P4.5) : le chef décrit le travail hors devis, les heures et le matériel
 * (sans prix), puis le client signe sur le téléphone. Les heures et le matériel sont repris en
 * facturation régie (M8). La signature demande du réseau : le PDF signé est produit par le serveur.
 */
export function WorkOrderSheet({
  open,
  onClose,
  projectId,
  customerName,
  team,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  customerName: string;
  team: { employeeId: string; name: string }[];
}) {
  const t = useTranslations('field.workOrder');
  const tc = useTranslations('common');
  const f = useField();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [id] = useState(() => uuidv7());
  const [step, setStep] = useState<'describe' | 'sign'>('describe');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<Line[]>(() =>
    team.length
      ? team.map((p) => ({
          key: uuidv7(),
          kind: 'labour',
          description: p.name,
          quantity: '',
          unit: 'h',
          employeeId: p.employeeId,
        }))
      : [{ key: uuidv7(), kind: 'labour', description: '', quantity: '', unit: 'h', employeeId: null }],
  );
  const [signer, setSigner] = useState(customerName);
  const [accept, setAccept] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);

  const update = (key: string, patch: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const validLines = () =>
    lines
      .filter((l) => l.description.trim() && parseQuantity(l.quantity))
      .map((l) => ({
        kind: l.kind,
        description: l.description.trim(),
        quantity: parseQuantity(l.quantity)!,
        unit: l.unit.trim() || (l.kind === 'labour' ? 'h' : 'pce'),
        employeeId: l.employeeId,
      }));

  const toSign = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (description.trim().length < 3) errs['description'] = t('descriptionRequired');
    if (!validLines().length) errs['lines'] = t('linesRequired');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!f.online) {
      setErrors({ form: t('needsNetwork') });
      return;
    }
    setPending(true);
    try {
      await api<WorkOrderDto>('/work-orders', {
        body: { id, projectId, day: today(), description: description.trim(), lines: validLines() },
      });
      setDraftId(id);
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
    if (Object.keys(errs).length || !draftId) return;
    setPending(true);
    try {
      const w = await api<WorkOrderDto>(`/work-orders/${draftId}/sign`, {
        body: { signerName: signer.trim(), acceptTerms: true, signaturePath: path },
      });
      toast.show({ title: t('signed', { number: w.number ?? '' }), tone: 'good' });
      onClose();
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={step === 'describe' ? t('title') : t('signTitle')}
      description={step === 'describe' ? t('subtitle') : t('signSubtitle', { name: customerName })}
      closeLabel={tc('close')}
      footer={
        step === 'describe' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" form="field-work-order" loading={pending} size="lg">
              {t('toSign')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setStep('describe')}>
              {tc('back')}
            </Button>
            <Button type="submit" form="field-work-order-sign" loading={pending} size="lg" variant="accent">
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
        <form
          id="field-work-order"
          onSubmit={(e) => void toSign(e)}
          className="flex flex-col gap-4"
          noValidate
        >
          <TextAreaField
            label={t('description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('descriptionPlaceholder')}
            error={errors['description']}
            rows={3}
            maxLength={4000}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-[14px] font-semibold">{t('lines')}</legend>
            {lines.map((l, i) => (
              <div key={l.key} className="grid grid-cols-[1fr_88px_44px] items-end gap-2">
                <TextField
                  label={l.kind === 'labour' ? t('labour') : t('material')}
                  value={l.description}
                  onChange={(e) => update(l.key, { description: e.target.value })}
                  placeholder={l.kind === 'labour' ? t('labourPlaceholder') : t('materialPlaceholder')}
                />
                <TextField
                  label={l.kind === 'labour' ? t('hours') : t('quantity')}
                  value={l.quantity}
                  inputMode="decimal"
                  onChange={(e) => update(l.key, { quantity: e.target.value })}
                  trailing={<span className="pr-2 text-[13px] text-muted">{l.unit}</span>}
                />
                <Button
                  variant="ghost"
                  aria-label={t('removeLine', { n: i + 1 })}
                  onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}
                  disabled={lines.length === 1}
                  className="px-0"
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            ))}
            {errors['lines'] ? (
              <p role="alert" className="text-[13px] text-crit">
                {errors['lines']}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() =>
                  setLines((all) => [
                    ...all,
                    {
                      key: uuidv7(),
                      kind: 'labour',
                      description: '',
                      quantity: '',
                      unit: 'h',
                      employeeId: null,
                    },
                  ])
                }
              >
                {t('addLabour')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() =>
                  setLines((all) => [
                    ...all,
                    {
                      key: uuidv7(),
                      kind: 'material',
                      description: '',
                      quantity: '',
                      unit: 'pce',
                      employeeId: null,
                    },
                  ])
                }
              >
                {t('addMaterial')}
              </Button>
            </div>
          </fieldset>
          <p className="text-[12px] text-muted">{t('noPrices')}</p>
        </form>
      ) : (
        <form
          id="field-work-order-sign"
          onSubmit={(e) => void sign(e)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="rounded-[12px] bg-line-soft p-3 text-[14px]">
            <p className="font-medium">{description}</p>
            <ul className="mt-1 text-[13px] text-muted">
              {validLines().map((l, i) => (
                <li key={i}>
                  {l.description} — {l.quantity.replace('.', ',')} {l.unit}
                </li>
              ))}
            </ul>
          </div>
          <TextField
            label={t('signerName')}
            value={signer}
            onChange={(e) => setSigner(e.target.value)}
            error={errors['signer']}
            autoComplete="name"
          />
          <SignaturePad onChange={setPath} />
          <div>
            <Checkbox label={t('accept')} checked={accept} onChange={(e) => setAccept(e.target.checked)} />
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
