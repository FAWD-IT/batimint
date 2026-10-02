'use client';

/**
 * ⌘K (03 §15) : recherche multi-objets et actions rapides, au clavier. `?` affiche les
 * raccourcis, « g » puis une lettre navigue (g c → chantiers, g d → devis…).
 */
import type { SearchResultDto } from '@batimint/contracts';
import { cn, Dialog, Spinner } from '@batimint/ui';
import {
  Briefcase,
  Building2,
  CornerDownLeft,
  FileText,
  Keyboard,
  type LucideIcon,
  Package,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NAV_ITEMS } from '@/components/shell/nav';
import { useApi } from '@/lib/hooks';
import { useCan, useSession } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';

interface CommandApi {
  open(): void;
  openShortcuts(): void;
}

const CommandContext = createContext<CommandApi | null>(null);

export function useCommandPalette(): CommandApi {
  const ctx = useContext(CommandContext);
  if (!ctx) throw new Error('useCommandPalette hors de CommandPaletteProvider');
  return ctx;
}

/** Navigation « g » + lettre (raccourcis à la Linear). */
const GO_KEYS: Record<string, string> = {
  a: '/aujourdhui',
  c: '/chantiers',
  d: '/devis',
  l: '/clients',
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    Boolean(el.closest('dialog'))
  );
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const router = useRouter();
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
        return;
      }
      if (pendingG.current && GO_KEYS[e.key]) {
        e.preventDefault();
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        router.push(GO_KEYS[e.key]!);
        return;
      }
      if (e.key === 'g') {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  const api = useMemo<CommandApi>(
    () => ({ open: () => setOpen(true), openShortcuts: () => setHelp(true) }),
    [],
  );
  return (
    <CommandContext.Provider value={api}>
      {children}
      {open ? (
        <CommandPalette
          onClose={() => setOpen(false)}
          onShortcuts={() => {
            setOpen(false);
            setHelp(true);
          }}
        />
      ) : null}
      {help ? <ShortcutsDialog onClose={() => setHelp(false)} /> : null}
    </CommandContext.Provider>
  );
}

interface Entry {
  id: string;
  group: string;
  title: string;
  subtitle?: string | null;
  icon: LucideIcon;
  run: () => void;
}

const TYPE_ICONS: Record<SearchResultDto['type'], LucideIcon> = {
  project: Building2,
  quote: FileText,
  customer: Users,
  opportunity: Briefcase,
  item: Package,
};

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

function CommandPalette({ onClose, onShortcuts }: { onClose: () => void; onShortcuts: () => void }) {
  const t = useTranslations('command');
  const tn = useTranslations('nav');
  const router = useRouter();
  const can = useCan();
  const me = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const query = useDebounced(q.trim(), 150);
  const search = useApi<{ items: SearchResultDto[] }>(
    ['search', query],
    query.length >= 2 ? `/search?q=${encodeURIComponent(query)}` : null,
  );

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    inputRef.current?.focus();
  }, []);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const entries = useMemo<Entry[]>(() => {
    const term = normalize(q.trim());
    const match = (s: string) => !term || normalize(s).includes(term);
    const actions: Entry[] = [
      ...(can('quotes.write')
        ? [{ id: 'a-quote', title: t('actions.newQuote'), href: '/devis?nouveau=1', icon: Plus }]
        : []),
      ...(can('customers.write')
        ? [{ id: 'a-customer', title: t('actions.newCustomer'), href: '/clients?nouveau=1', icon: Plus }]
        : []),
      ...(can('leads.write')
        ? [{ id: 'a-opp', title: t('actions.newOpportunity'), href: '/opportunites?nouveau=1', icon: Plus }]
        : []),
    ]
      .filter((a) => match(a.title))
      .map((a) => ({
        id: a.id,
        group: t('groups.actions'),
        title: a.title,
        icon: a.icon,
        run: () => go(a.href),
      }));
    if (match(t('actions.shortcuts')))
      actions.push({
        id: 'a-shortcuts',
        group: t('groups.actions'),
        title: t('actions.shortcuts'),
        icon: Keyboard,
        run: onShortcuts,
      });
    const nav: Entry[] = NAV_ITEMS.filter(
      (i) => (!i.permission || can(i.permission)) && (!i.platformAdmin || me.user.isPlatformAdmin),
    )
      .filter((i) => match(tn(i.labelKey)))
      .map((i) => ({
        id: `n-${i.href}`,
        group: t('groups.navigation'),
        title: tn(i.labelKey),
        icon: i.icon,
        run: () => go(i.href),
      }));
    const results: Entry[] =
      query.length >= 2 && query === q.trim()
        ? (search.data?.items ?? []).map((r) => ({
            id: `${r.type}-${r.id}`,
            group: t(`groups.${r.type}`),
            title: r.title,
            subtitle: r.subtitle,
            icon: TYPE_ICONS[r.type],
            run: () => go(r.href),
          }))
        : [];
    // Avec une recherche, les résultats passent avant les actions.
    return term ? [...results, ...actions, ...nav] : [...actions, ...nav];
  }, [q, query, search.data, can, me.user.isPlatformAdmin, t, tn, go, onShortcuts]);

  useEffect(() => setActive(0), [q, search.data]);

  const groups = useMemo(() => {
    const out: { name: string; items: (Entry & { index: number })[] }[] = [];
    entries.forEach((e, index) => {
      const g = out.find((x) => x.name === e.group);
      if (g) g.items.push({ ...e, index });
      else out.push({ name: e.group, items: [{ ...e, index }] });
    });
    return out;
  }, [entries]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(entries.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      entries[active]?.run();
    }
  };

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const loading = search.isFetching && query.length >= 2;
  return (
    <dialog
      ref={ref}
      aria-label={t('title')}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="mx-auto mt-[12vh] w-[min(94vw,640px)] overflow-hidden rounded-[16px] border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <div className="flex items-center gap-3 border-b border-line-soft px-4">
        {loading ? <Spinner className="size-4" /> : <Search aria-hidden className="size-4 text-muted" />}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={entries.length ? `${listId}-${active}` : undefined}
          aria-label={t('label')}
          aria-autocomplete="list"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('placeholder')}
          className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted"
        />
        <kbd className="hidden rounded-[6px] border border-line px-1.5 py-0.5 text-[11px] text-muted sm:inline">
          Esc
        </kbd>
      </div>
      <div id={listId} role="listbox" aria-label={t('results')} className="max-h-[55vh] overflow-y-auto p-2">
        {entries.length === 0 ? (
          <p className="px-3 py-6 text-center text-[14px] text-muted" role="status">
            {loading ? null : t('empty', { q: q.trim() })}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name} className="mb-1">
              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
                {g.name}
              </p>
              {g.items.map((e) => {
                const Icon = e.icon;
                const selected = e.index === active;
                return (
                  <div
                    key={e.id}
                    id={`${listId}-${e.index}`}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(e.index)}
                    onClick={e.run}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2',
                      selected ? 'bg-line-soft' : '',
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{e.title}</span>
                      {e.subtitle ? (
                        <span className="block truncate text-[12px] text-muted">{e.subtitle}</span>
                      ) : null}
                    </span>
                    {selected ? <CornerDownLeft aria-hidden className="size-3.5 text-muted" /> : null}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      <p className="border-t border-line-soft px-4 py-2.5 text-[12px] text-muted">{t('hint')}</p>
    </dialog>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-[6px] border border-line bg-bg px-1.5 py-0.5 font-sans text-[12px] font-semibold">
      {children}
    </kbd>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('command.shortcuts');
  const tc = useTranslations('common');
  const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const rows: [ReactNode, string][] = [
    [
      <>
        <Kbd>{mod}</Kbd> <Kbd>K</Kbd>
      </>,
      t('palette'),
    ],
    [<Kbd key="q">?</Kbd>, t('help')],
    [<GoKeys key="a" k="A" then={t('then')} />, t('goToday')],
    [<GoKeys key="c" k="C" then={t('then')} />, t('goProjects')],
    [<GoKeys key="d" k="D" then={t('then')} />, t('goQuotes')],
    [<GoKeys key="l" k="L" then={t('then')} />, t('goCustomers')],
    [<Kbd key="e">Esc</Kbd>, t('close')],
  ];
  return (
    <Dialog open onClose={onClose} title={t('title')} closeLabel={tc('close')}>
      <dl className="flex flex-col divide-y divide-line-soft">
        {rows.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-[14px]">{label}</dt>
            <dd className="flex shrink-0 items-center gap-1">{keys}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

function GoKeys({ k, then }: { k: string; then: string }) {
  return (
    <>
      <Kbd>G</Kbd>
      <span className="text-[12px] text-muted">{then}</span>
      <Kbd>{k}</Kbd>
    </>
  );
}
