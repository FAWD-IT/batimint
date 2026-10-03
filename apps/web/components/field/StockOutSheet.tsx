'use client';

import type { ProjectDto, StockItemDto, StockLocationDto } from '@batimint/contracts';
import { dec, formatQuantity } from '@batimint/domain';
import { Button, Dialog, SelectField, TextField, useToast } from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { parseQuantity } from '@/components/stock/StockDialogs';
import { useApi } from '@/lib/hooks';
import { useField } from './FieldProvider';

/**
 * Sortie de matériaux sur le chantier (P13, tutoiement) : le chef prend dans sa camionnette (ou
 * au dépôt) ; la sortie part dans la file terrain (identifiant généré ici, renvoi sans doublon)
 * et le coût moyen pondéré est imputé au chantier du jour.
 */
export function StockOutSheet({
  projectId,
  projectName,
  employeeId,
  onClose,
}: {
  projectId: string;
  projectName: string;
  employeeId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('fieldStock');
  const tc = useTranslations('common');
  const f = useField();
  const toast = useToast();
  const [id, setId] = useState(() => uuidv7());
  const locations = useApi<{ items: StockLocationDto[] }>(['stock', 'locations'], '/stock/locations');
  const mine = locations.data?.items.find((l) => l.employee?.id && l.employee.id === employeeId);
  const [chosen, setChosen] = useState<string | null>(null);
  const locationId = chosen ?? mine?.id ?? locations.data?.items[0]?.id ?? '';
  const stock = useApi<{ items: StockItemDto[] }>(
    ['stock', 'items', locationId],
    locationId ? `/stock?locationId=${locationId}` : null,
  );
  const project = useApi<ProjectDto>(['project', projectId], `/projects/${projectId}`);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);

  const available = (stock.data?.items ?? []).filter((i) => dec(i.levels[0]?.quantity ?? '0').gt(0));
  const item = available.find((i) => i.item.id === itemId);
  const qty = parseQuantity(quantity);
  const errors = {
    item: !item ? t('errors.item') : null,
    quantity: !qty || dec(qty).lte(0) ? t('errors.quantity') : null,
  };

  const submit = async () => {
    setSubmitted(true);
    if (errors.item || errors.quantity || !item || !qty) return;
    setPending(true);
    try {
      await f.enqueue({
        type: 'stock',
        id,
        data: {
          id,
          kind: 'out',
          itemId: item.item.id,
          locationId,
          quantity: qty,
          projectId,
          budgetLineId: budgetLineId || null,
          note: null,
        },
      });
      toast.show({
        title: t('saved', { quantity: formatQuantity(qty), unit: item.item.unit, item: item.item.name }),
        tone: 'good',
      });
      setId(uuidv7());
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('description', { project: projectName })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={pending} disabled={!available.length} onClick={() => void submit()}>
            {t('save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <SelectField
          label={t('location')}
          value={locationId}
          onChange={(e) => {
            setChosen(e.target.value);
            setItemId('');
          }}
          options={(locations.data?.items ?? []).map((l) => ({ value: l.id, label: l.name }))}
        />
        {stock.data && !available.length ? (
          <p className="text-[14px] text-muted" role="status">
            {t('empty')}
          </p>
        ) : (
          <>
            <SelectField
              label={t('item')}
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              options={[
                { value: '', label: t('chooseItem') },
                ...available.map((i) => ({ value: i.item.id, label: i.item.name })),
              ]}
              error={submitted ? errors.item : null}
              hint={
                item
                  ? t('available', {
                      quantity: formatQuantity(item.levels[0]!.quantity),
                      unit: item.item.unit,
                    })
                  : undefined
              }
            />
            <TextField
              label={t('quantity', { unit: item?.item.unit ?? '—' })}
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              error={submitted ? errors.quantity : null}
            />
            {project.data?.budgetLines?.length ? (
              <SelectField
                label={t('post')}
                value={budgetLineId}
                onChange={(e) => setBudgetLineId(e.target.value)}
                options={[
                  { value: '', label: t('noPost') },
                  ...project.data.budgetLines.map((b) => ({ value: b.id, label: b.label })),
                ]}
              />
            ) : null}
          </>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
