/**
 * Équipes, employés et absences (03 §1). L'INSS est chiffré au repos, visible seulement par
 * Owner et Admin, et chaque consultation est journalisée (05 §9).
 */
import {
  AbsenceInputSchema,
  AbsenceSchema,
  EmployeeInputSchema,
  EmployeeSchema,
  OkSchema,
  TeamInputSchema,
  TeamSchema,
} from '@batimint/contracts';
import { type Tx } from '@batimint/db';
import { can, formatInss, isValidInss, normalizeInss, type Role } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, notFound } from '../lib/errors';
import { inTenant, isoDate } from '../lib/tenant';

type EmployeeRow = Awaited<ReturnType<Tx['employee']['findUniqueOrThrow']>>;

function toEmployeeDto(e: EmployeeRow, role: Role) {
  return {
    id: e.id,
    userId: e.userId,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    phone: e.phone,
    jobTitle: e.jobTitle,
    rateProfile: e.rateProfile,
    ...(can(role, 'pricing.read') ? { hourlyCost: Number(e.hourlyCost) } : {}),
    skills: e.skills,
    hasInss: Boolean(e.inssEnc),
    inssMasked: e.inssLast4 ? `••.••.••-•••.${e.inssLast4.slice(-2)}` : null,
    teamId: e.teamId,
    isSubcontractor: e.isSubcontractor,
    active: e.active,
    hiredOn: isoDate(e.hiredOn),
  };
}

const parseDate = (v: string | null | undefined) =>
  v ? new Date(`${v}T00:00:00Z`) : v === null ? null : undefined;

export const peopleRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  // --- Équipes ---
  app.get(
    '/teams',
    {
      schema: {
        tags: ['équipes'],
        summary: 'Équipes',
        response: { 200: z.object({ items: z.array(TeamSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'employees.read', async ({ tx }) => {
        const teams = await tx.team.findMany({
          where: { archivedAt: null },
          include: { members: { select: { id: true } } },
          orderBy: { name: 'asc' },
        });
        return {
          items: teams.map((t) => ({
            id: t.id,
            name: t.name,
            color: t.color,
            leaderEmployeeId: t.leaderEmployeeId,
            memberIds: t.members.map((m) => m.id),
          })),
        };
      }),
  );

  const saveTeam = async (
    tx: Tx,
    tenantId: string,
    id: string | null,
    body: z.infer<typeof TeamInputSchema>,
    userId: string,
  ) => {
    const team = id
      ? await tx.team.update({
          where: { id },
          data: { name: body.name, color: body.color, leaderEmployeeId: body.leaderEmployeeId ?? null },
        })
      : await tx.team.create({
          data: {
            tenantId,
            name: body.name,
            color: body.color,
            leaderEmployeeId: body.leaderEmployeeId ?? null,
            createdBy: userId,
          },
        });
    if (body.memberIds) {
      await tx.employee.updateMany({
        where: { teamId: team.id, id: { notIn: body.memberIds } },
        data: { teamId: null },
      });
      await tx.employee.updateMany({ where: { id: { in: body.memberIds } }, data: { teamId: team.id } });
    }
    const members = await tx.employee.findMany({ where: { teamId: team.id }, select: { id: true } });
    return {
      id: team.id,
      name: team.name,
      color: team.color,
      leaderEmployeeId: team.leaderEmployeeId,
      memberIds: members.map((m) => m.id),
    };
  };

  app.post(
    '/teams',
    {
      schema: {
        tags: ['équipes'],
        summary: 'Créer une équipe',
        body: TeamInputSchema,
        response: { 201: TeamSchema },
      },
    },
    async (req, reply) => {
      const team = await inTenant(deps, req, 'teams.manage', async ({ tx, auth, audit }) => {
        const t = await saveTeam(tx, auth.tenantId, null, req.body, auth.userId);
        await audit('team.created', 'team', t.id, req.body);
        return t;
      });
      return reply.status(201).send(team);
    },
  );

  app.put(
    '/teams/:id',
    {
      schema: {
        tags: ['équipes'],
        summary: 'Modifier une équipe',
        params: z.object({ id: z.uuid() }),
        body: TeamInputSchema,
        response: { 200: TeamSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'teams.manage', async ({ tx, auth, audit }) => {
        if (!(await tx.team.findUnique({ where: { id: req.params.id } }))) throw notFound('Cette équipe');
        const t = await saveTeam(tx, auth.tenantId, req.params.id, req.body, auth.userId);
        await audit('team.updated', 'team', t.id, req.body);
        return t;
      }),
  );

  app.delete(
    '/teams/:id',
    {
      schema: {
        tags: ['équipes'],
        summary: 'Archiver une équipe',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'teams.manage', async ({ tx, audit }) => {
        const res = await tx.team.updateMany({
          where: { id: req.params.id, archivedAt: null },
          data: { archivedAt: new Date() },
        });
        if (res.count === 0) throw notFound('Cette équipe');
        await tx.employee.updateMany({ where: { teamId: req.params.id }, data: { teamId: null } });
        await audit('team.archived', 'team', req.params.id);
        return { ok: true as const };
      }),
  );

  // --- Employés ---
  app.get(
    '/employees',
    {
      schema: {
        tags: ['équipes'],
        summary: 'Employés',
        querystring: z.object({ includeInactive: z.stringbool().default(false) }),
        response: { 200: z.object({ items: z.array(EmployeeSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'employees.read', async ({ tx, auth }) => {
        const rows = await tx.employee.findMany({
          where: req.query.includeInactive ? {} : { active: true },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        });
        return { items: rows.map((e) => toEmployeeDto(e, auth.role)) };
      }),
  );

  const employeeData = (body: z.infer<typeof EmployeeInputSchema>, deps: AppDeps) => {
    const data: Record<string, unknown> = {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email ?? null,
      phone: body.phone ?? null,
      jobTitle: body.jobTitle ?? null,
      rateProfile: body.rateProfile ?? null,
      skills: body.skills ?? [],
      teamId: body.teamId ?? null,
      isSubcontractor: body.isSubcontractor ?? false,
      active: body.active ?? true,
      hiredOn: parseDate(body.hiredOn) ?? null,
    };
    if (body.hourlyCost !== undefined) data['hourlyCost'] = BigInt(body.hourlyCost);
    if (body.inss !== undefined) {
      if (body.inss === null || body.inss === '') {
        data['inssEnc'] = null;
        data['inssLast4'] = null;
      } else {
        if (!isValidInss(body.inss))
          throw badRequest(
            'invalid_inss',
            "Ce numéro INSS n'est pas valide (11 chiffres, ex. 85.07.30-033.28).",
          );
        const n = normalizeInss(body.inss)!;
        data['inssEnc'] = deps.cipher.encrypt(n);
        data['inssLast4'] = n.slice(-4);
      }
    }
    return data;
  };

  app.post(
    '/employees',
    {
      schema: {
        tags: ['équipes'],
        summary: 'Ajouter un employé',
        body: EmployeeInputSchema,
        response: { 201: EmployeeSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'employees.manage', async ({ tx, auth, audit }) => {
        if (req.body.inss && !can(auth.role, 'employees.sensitive.read'))
          throw badRequest('inss_forbidden', "Seuls le patron et l'administrateur peuvent saisir l'INSS.");
        const created = await tx.employee.create({
          data: {
            ...(employeeData(req.body, deps) as object),
            ...(req.body.id ? { id: req.body.id } : {}),
            tenantId: auth.tenantId,
            createdBy: auth.userId,
          } as never,
        });
        await audit('employee.created', 'employee', created.id, {
          firstName: created.firstName,
          lastName: created.lastName,
          inss: req.body.inss ? 'saisi' : undefined,
        });
        return toEmployeeDto(created, auth.role);
      });
      return reply.status(201).send(dto);
    },
  );

  app.put(
    '/employees/:id',
    {
      schema: {
        tags: ['équipes'],
        summary: 'Modifier un employé',
        params: z.object({ id: z.uuid() }),
        body: EmployeeInputSchema,
        response: { 200: EmployeeSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'employees.manage', async ({ tx, auth, audit }) => {
        if (req.body.inss !== undefined && !can(auth.role, 'employees.sensitive.read')) {
          throw badRequest('inss_forbidden', "Seuls le patron et l'administrateur peuvent modifier l'INSS.");
        }
        const before = await tx.employee.findUnique({ where: { id: req.params.id } });
        if (!before) throw notFound('Cet employé');
        const data = employeeData(req.body, deps);
        if (req.body.hourlyCost === undefined) delete data['hourlyCost'];
        const after = await tx.employee.update({ where: { id: req.params.id }, data });
        const changed = Object.keys(data).filter(
          (k) =>
            !['inssEnc', 'inssLast4'].includes(k) &&
            JSON.stringify((before as Record<string, unknown>)[k], (_k, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ) !==
              JSON.stringify((after as Record<string, unknown>)[k], (_k, v) =>
                typeof v === 'bigint' ? v.toString() : v,
              ),
        );
        await audit('employee.updated', 'employee', after.id, {
          fields: changed,
          inss: req.body.inss !== undefined ? 'modifié' : undefined,
        });
        return toEmployeeDto(after, auth.role);
      }),
  );

  app.get(
    '/employees/:id/inss',
    {
      schema: {
        tags: ['équipes'],
        summary: "Afficher l'INSS (Owner et Admin, consultation journalisée)",
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ inss: z.string().nullable() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'employees.sensitive.read', async ({ tx, audit }) => {
        const e = await tx.employee.findUnique({ where: { id: req.params.id } });
        if (!e) throw notFound('Cet employé');
        await audit('employee.inss_viewed', 'employee', e.id);
        return { inss: e.inssEnc ? formatInss(deps.cipher.decrypt(e.inssEnc)) : null };
      }),
  );

  // --- Absences ---
  const toAbsenceDto = (a: Awaited<ReturnType<Tx['absence']['findUniqueOrThrow']>>) => ({
    id: a.id,
    employeeId: a.employeeId,
    kind: a.kind,
    startsOn: isoDate(a.startsOn)!,
    endsOn: isoDate(a.endsOn)!,
    halfDay: (a.halfDay as 'am' | 'pm' | null) ?? null,
    note: a.note,
  });

  app.get(
    '/absences',
    {
      schema: {
        tags: ['équipes'],
        summary: 'Congés et indisponibilités',
        querystring: z.object({
          from: z.iso.date().optional(),
          to: z.iso.date().optional(),
          employeeId: z.uuid().optional(),
        }),
        response: { 200: z.object({ items: z.array(AbsenceSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'employees.read', async ({ tx }) => {
        const q = req.query;
        const rows = await tx.absence.findMany({
          where: {
            ...(q.employeeId ? { employeeId: q.employeeId } : {}),
            ...(q.to ? { startsOn: { lte: new Date(`${q.to}T00:00:00Z`) } } : {}),
            ...(q.from ? { endsOn: { gte: new Date(`${q.from}T00:00:00Z`) } } : {}),
          },
          orderBy: { startsOn: 'asc' },
          take: 500,
        });
        return { items: rows.map(toAbsenceDto) };
      }),
  );

  app.post(
    '/employees/:id/absences',
    {
      schema: {
        tags: ['équipes'],
        summary: 'Déclarer une absence',
        params: z.object({ id: z.uuid() }),
        body: AbsenceInputSchema,
        response: { 201: AbsenceSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'employees.manage', async ({ tx, auth, audit }) => {
        if (!(await tx.employee.findUnique({ where: { id: req.params.id } }))) throw notFound('Cet employé');
        const a = await tx.absence.create({
          data: {
            tenantId: auth.tenantId,
            employeeId: req.params.id,
            kind: req.body.kind,
            startsOn: new Date(`${req.body.startsOn}T00:00:00Z`),
            endsOn: new Date(`${req.body.endsOn}T00:00:00Z`),
            halfDay: req.body.halfDay ?? null,
            note: req.body.note ?? null,
            createdBy: auth.userId,
          },
        });
        await audit('absence.created', 'absence', a.id, req.body);
        return toAbsenceDto(a);
      });
      return reply.status(201).send(dto);
    },
  );

  app.delete(
    '/absences/:id',
    {
      schema: {
        tags: ['équipes'],
        summary: 'Supprimer une absence',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'employees.manage', async ({ tx, audit }) => {
        const res = await tx.absence.deleteMany({ where: { id: req.params.id } });
        if (res.count === 0) throw notFound('Cette absence');
        await audit('absence.deleted', 'absence', req.params.id);
        return { ok: true as const };
      }),
  );
};
