'use client';

import type { EmployeeDto, TenantSettings } from '@batimint/contracts';
import { Button, Drawer, Notice, SelectField, Switch, TextField } from '@batimint/ui';
import { Eye, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { MoneyInput } from '@/components/MoneyInput';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import type { Team } from './PeopleView';

export function EmployeeDrawer({
  employee,
  teams,
  rateProfiles,
  onClose,
}: {
  employee: EmployeeDto | null;
  teams: Team[];
  rateProfiles: TenantSettings['rateProfiles'];
  onClose: () => void;
}) {
  const t = useTranslations('people');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const canSensitive = can('employees.sensitive.read');
  const canPrices = can('pricing.read');
  const [v, setV] = useState({
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    jobTitle: employee?.jobTitle ?? '',
    rateProfile: employee?.rateProfile ?? '',
    hourlyCost: employee?.hourlyCost ?? 0,
    skills: employee?.skills.join(', ') ?? '',
    teamId: employee?.teamId ?? '',
    isSubcontractor: employee?.isSubcontractor ?? false,
    active: employee?.active ?? true,
    hiredOn: employee?.hiredOn ?? '',
  });
  const [inss, setInss] = useState<string | null>(null);
  const [inssEditing, setInssEditing] = useState(!employee?.hasInss);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [revealError, setRevealError] = useState<string | null>(null);

  const save = useApiMutation<Record<string, unknown>>(
    (body) =>
      employee ? { path: `/employees/${employee.id}`, method: 'PUT', body } : { path: '/employees', body },
    { invalidate: [['employees'], ['teams']], successMessage: t('saved'), onSuccess: onClose },
  );

  const reveal = async () => {
    if (!employee) return;
    try {
      const r = await api<{ inss: string | null }>(`/employees/${employee.id}/inss`);
      setInss(r.inss);
    } catch (err) {
      setRevealError(errorMessage(err));
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!v.firstName.trim()) errs['firstName'] = tc('name');
    if (!v.lastName.trim()) errs['lastName'] = tc('name');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const profile = rateProfiles.find((r) => r.key === v.rateProfile);
    const body: Record<string, unknown> = {
      firstName: v.firstName.trim(),
      lastName: v.lastName.trim(),
      email: v.email.trim() || null,
      phone: v.phone.trim() || null,
      jobTitle: v.jobTitle.trim() || null,
      rateProfile: v.rateProfile || null,
      skills: v.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      teamId: v.teamId || null,
      isSubcontractor: v.isSubcontractor,
      active: v.active,
      hiredOn: v.hiredOn || null,
    };
    if (canPrices) body['hourlyCost'] = v.hourlyCost || profile?.costPerHour || 0;
    if (canSensitive && inssEditing && inss !== null) body['inss'] = inss.trim() || null;
    save.mutate(body);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={employee ? t('editEmployee') : t('addEmployee')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="employee-form" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="employee-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('firstName')}
            value={v.firstName}
            onChange={(e) => setV({ ...v, firstName: e.target.value })}
            error={errors['firstName'] ? ' ' : null}
            autoFocus
          />
          <TextField
            label={t('lastName')}
            value={v.lastName}
            onChange={(e) => setV({ ...v, lastName: e.target.value })}
            error={errors['lastName'] ? ' ' : null}
          />
        </div>
        <TextField
          label={t('jobTitle')}
          value={v.jobTitle}
          onChange={(e) => setV({ ...v, jobTitle: e.target.value })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={tc('email')}
            type="email"
            value={v.email}
            onChange={(e) => setV({ ...v, email: e.target.value })}
          />
          <TextField
            label={tc('phone')}
            type="tel"
            value={v.phone}
            onChange={(e) => setV({ ...v, phone: e.target.value })}
          />
        </div>
        <SelectField
          label={t('team')}
          value={v.teamId}
          onChange={(e) => setV({ ...v, teamId: e.target.value })}
          options={[{ value: '', label: t('noTeam') }, ...teams.map((x) => ({ value: x.id, label: x.name }))]}
        />
        {canPrices ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t('rateProfile')}
              value={v.rateProfile}
              onChange={(e) => {
                const p = rateProfiles.find((r) => r.key === e.target.value);
                setV({ ...v, rateProfile: e.target.value, hourlyCost: p ? p.costPerHour : v.hourlyCost });
              }}
              options={[
                { value: '', label: '—' },
                ...rateProfiles.map((r) => ({ value: r.key, label: r.label })),
              ]}
            />
            <MoneyInput
              label={t('hourlyCost')}
              cents={v.hourlyCost}
              onChange={(c) => setV({ ...v, hourlyCost: c })}
            />
          </div>
        ) : null}
        <TextField
          label={t('skills')}
          hint={t('skillsHint')}
          value={v.skills}
          onChange={(e) => setV({ ...v, skills: e.target.value })}
        />
        <TextField
          label={t('hiredOn')}
          type="date"
          value={v.hiredOn}
          onChange={(e) => setV({ ...v, hiredOn: e.target.value })}
        />
        <div className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Lock aria-hidden className="size-4" /> {t('inss')}
          </div>
          {canSensitive ? (
            inssEditing ? (
              <TextField
                label={t('inss')}
                hint={t('inssHint')}
                value={inss ?? ''}
                onChange={(e) => setInss(e.target.value)}
                placeholder="85.07.30-033.28"
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-[14px]">{inss ?? employee?.inssMasked}</code>
                {inss === null ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Eye aria-hidden className="size-4" />}
                    onClick={() => void reveal()}
                  >
                    {t('inssShow')}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setInss('');
                    setInssEditing(true);
                  }}
                >
                  {t('inssReplace')}
                </Button>
              </div>
            )
          ) : (
            <p className="text-[13px] text-muted">
              {employee?.hasInss ? `${employee.inssMasked} · ${t('inssHidden')}` : t('inssHidden')}
            </p>
          )}
          {revealError ? <Notice tone="crit">{revealError}</Notice> : null}
        </div>
        <Switch
          label={t('subcontractor')}
          checked={v.isSubcontractor}
          onChange={(x) => setV({ ...v, isSubcontractor: x })}
        />
        {employee ? (
          <Switch label={t('active')} checked={v.active} onChange={(x) => setV({ ...v, active: x })} />
        ) : null}
      </form>
    </Drawer>
  );
}
