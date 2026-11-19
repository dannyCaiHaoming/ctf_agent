// Offline replay. Run from the repository root with:
// node --import tsx tests/manual/workbook-omission-replay.mts [--self-test]
import { strict as assert } from 'node:assert';
import { chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WORKBOOK_SLOTS, type WorkbookSlot as Slot } from '../../apps/launcher/src/experience-store.js';
import { redactProgressText } from '../../apps/launcher/src/progress-ledger.js';
import {
  activeEntries, coordinatorView, COORDINATOR_MAX_CHARS, SLOT_CAPS, workbookView,
  type CoordinatorChallenge, type WorkbookEntry, type WorkbookHost,
} from './workbook-legacy-view.js';
// Production view after the 2026-11-19 omission rule; compared against the P4 reference with --prod-equivalence.
import {
  coordinatorView as prodCoordinatorView, workbookView as prodWorkbookView,
} from '../../apps/launcher/src/workbook.js';

function selfTest() {
  const row = (id: number, slot: Slot, length = 300, status?: string): ReplayRow => ({
    id, sequence: id, role: 'recon', kind: 'decision', challenge_id: 'fixture',
    updated_at: id, note_json: { slot, text: 'x'.repeat(length), status },
  });
  const fixture = (role: Role, rows: ReplayRow[]) => ({
    role, rows, challenges: ['fixture'], padding: 0,
  });
  const tiny = fixture('domain-solver', [row(1, 'facts', 30), row(2, 'questions', 30, 'open')]);
  for (const policy of Object.values(policies)) {
    const result = replay(tiny, policy);
    assert.deepEqual(result.included, [1, 2]);
    assert.deepEqual(result.compressed, []);
  }

  const facts = Array.from({ length: SLOT_CAPS.facts + 1 }, (_, i) => row(i + 1, 'facts', 20));
  for (const policy of Object.values(policies)) {
    const result = replay(fixture('recon', facts), policy);
    assert.deepEqual(result.omitted, [1]);
    assert.deepEqual(result.compressed, []);
  }

  const mixed = fixture('domain-solver', [
    row(1, 'questions', 300, 'open'), row(2, 'hypotheses', 300, 'open'),
    row(3, 'refuted'), row(4, 'facts'), row(5, 'candidate', 300, 'proposed'),
  ]);
  const baseline = replay(mixed, policies.P0);
  const cap = baseline.chars - 150;
  assert.deepEqual(replay({ ...mixed, padding: baseline.maxChars - cap }, policies.P0).omitted, [1]);
  assert.deepEqual(replay(mixed, policies.P1, cap).omitted, [3]);
  const compressed = replay(mixed, policies.P2, cap);
  assert.deepEqual(compressed.omitted, []);
  assert.deepEqual(compressed.compressed, [3]);
  const tighter = baseline.chars - 500;
  assert.deepEqual(replay(mixed, policies.P1, tighter).omitted, [3, 4]);
  assert.deepEqual(replay(mixed, policies.P1, baseline.chars - 950).omitted, [2, 3, 4]);
  const bothCompressed = replay(mixed, policies.P2, baseline.chars - 400);
  assert.deepEqual(bothCompressed.omitted, []);
  assert.deepEqual(bothCompressed.compressed, [3, 4]);
  const oneDropped = replay(mixed, policies.P2, bothCompressed.chars - 20);
  assert.deepEqual(oneDropped.compressedBeforeDropping, [3, 4]);
  assert.deepEqual(oneDropped.omitted, [3]);
  assert.deepEqual(oneDropped.compressed, [4]);
  const strict = baseline.chars - 1300;
  assert.deepEqual(replay(mixed, policies.P1, strict).omitted, [1, 2, 3, 4]);
  assert.deepEqual(replay(mixed, policies.P2, strict).included, [5]);

  const coordinator = fixture('coordinator', [row(1, 'questions', 220, 'open'), row(2, 'facts')]);
  const coordinatorCap = replay(coordinator, policies.P0).chars - 80;
  assert.deepEqual(replay(coordinator, policies.P2, coordinatorCap).compressed, [2]);
  assert.deepEqual(replay(coordinator, policies.P2, coordinatorCap).omitted, []);

  const quotaRows = fixture('domain-solver', [
    row(1, 'facts'), row(2, 'facts'), row(3, 'questions', 300, 'open'),
  ]);
  const quota = project(quotaRows);
  const empty = quota.sections.map(section => ({ ...section, entries: [] }));
  const available = 850;
  const quotaCap = chars(quota.render(empty, quota.omissions)) + available;
  const question = quota.sections[0]!.entries.find(v => v.entry.slot === 'questions')!;
  assert.ok(chars(question.current) > available * 0.45);
  assert.deepEqual(replay(quotaRows, policies.P3, quotaCap).omitted, [1]); // The question borrows from refuted.

  const multi = {
    ...fixture('coordinator', [row(1, 'questions', 300, 'open'), {
      ...row(2, 'facts'), challenge_id: 'newer',
    }]),
    challenges: ['fixture', 'newer'],
  };
  const multiBase = replay(multi, policies.P0);
  const multiWithPressure = { ...multi, padding: multiBase.maxChars - multiBase.chars + 50 };
  for (const policy of Object.values(policies)) {
    const result = replay(multiWithPressure, policy);
    assert.equal(result.collapsed, 1);
    assert.deepEqual(result.included, [2]);
    assert.deepEqual(result.omitted, []);
  }

  for (const role of roles) {
    const oldestProtected = row(1, 'hypotheses');
    oldestProtected.note_json.evidence_refs = ['resource-'.repeat(30)];
    const ordered = fixture(role, [
      oldestProtected, row(2, 'questions', 300, 'open'),
      row(3, 'hypotheses', 300, 'refuted'), row(4, 'hypotheses', 300, 'supported'),
      row(5, 'refuted'), row(6, 'facts'),
    ]);
    let result = replayP4(ordered);
    assert.deepEqual(result.included, [1, 2, 3, 4, 5, 6]);
    const order = [5, 6, 3, 4, 1, 2];
    const fullIds = new Set(result.included);
    const shortIds = new Set<number>();
    const omittedIds = new Set<number>();
    for (const [phase, id] of [...order.map(id => ['shorten', id] as const), ...order.map(id => ['drop', id] as const)]) {
      const limit = result.chars - 1;
      result = replayP4(ordered, limit);
      if (phase === 'shorten') {
        fullIds.delete(id);
        shortIds.add(id);
      } else {
        shortIds.delete(id);
        omittedIds.add(id);
      }
      const coverage = result.view.coverage;
      assert.deepEqual(coverage.full_ids, sortedIds(fullIds), `${role} ${phase} ${id} full IDs`);
      assert.deepEqual(coverage.short_ids, sortedIds(shortIds), `${role} ${phase} ${id} short IDs`);
      assert.deepEqual(coverage.omitted_ids, sortedIds(omittedIds), `${role} ${phase} ${id} omitted IDs`);
      assert.deepEqual(coverage.omitted_reasons, Object.fromEntries([...omittedIds].map(id => [id, 'total_cap'])));
      const protectedOmitted = sortedIds([...omittedIds].filter(id => id <= 2));
      assert.equal(coverage.capacity_shortfall, protectedOmitted.length ? true : undefined);
      assert.deepEqual(coverage.protected_omitted_ids, protectedOmitted.length ? protectedOmitted : undefined);
      assert.equal(result.chars, chars(result.view));
      assert.ok(result.chars <= limit);
      assert.deepEqual(replayP4(ordered, result.chars).view.coverage, coverage);
    }

    const hypotheses = Array.from({ length: 9 }, (_, i) => row(i + 1, 'hypotheses', 100, 'open'));
    const candidates = Array.from({ length: 4 }, (_, i) => row(i + 10, 'candidate', 100, 'proposed'));
    const input = fixture(role, [...hypotheses, ...candidates]);
    const quota = replayP4(input);
    const expectedRows = role === 'recon' ? hypotheses : [...hypotheses, ...candidates];
    assert.deepEqual(quota.included, sortedIds(expectedRows.map(row => row.id)));
    assert.deepEqual(quota.view.coverage.short_ids, role === 'recon' ? [1] : [1, 10]);
    assert.equal(quota.view.coverage.full_ids.length, expectedRows.length - quota.view.coverage.short_ids.length);
    assert.deepEqual(quota.view.coverage.omitted_ids, []);
    assert.equal(quota.view.coverage.capacity_shortfall, undefined);
  }
  const refuted = { ...row(1, 'refuted'), note_json: {
    slot: 'refuted' as const, text: 'first\r\n' + '𠮷'.repeat(90), scope: 'example', evidence_refs: ['ref-1'],
  } };
  const projected = openEntries([refuted])[0]!;
  assert.deepEqual(p4Short(projected, projected, 'recon'), {
    id: 1, slot: 'refuted', role: 'recon', text: 'first' + '𠮷'.repeat(75) + '…',
    truncated: true, evidence_refs_count: 1, scope_truncated: true,
  });
  const repeated = Array.from({ length: 4 }, (_, i) => row(i + 1, 'candidate', 100, 'proposed'));
  repeated[0]!.note_json.evidence_refs = ['ref-1'];
  const coordinatorShort = project(fixture('coordinator', repeated), true).sections[0]!.entries[0];
  assert.deepEqual(coordinatorShort?.current, {
    id: 1, role: 'recon', status: 'proposed', evidence_refs: ['ref-1'],
  });

  const multiP4 = replayP4(multi, replayP4(multi).chars - 1);
  assert.equal(multiP4.collapsed, 0);
  assert.deepEqual(multiP4.view.coverage.full_ids, [1]);
  assert.deepEqual(multiP4.view.coverage.short_ids, [2]);
  assert.deepEqual(multiP4.view.coverage.omitted_ids, []);
  console.log('self-test passed');
}


const roles = ['domain-solver', 'recon', 'coordinator'] as const;
type Role = typeof roles[number];
type ReplayRow = {
  id: number;
  sequence: number;
  role: string;
  kind: string;
  challenge_id: string;
  updated_at: number;
  note_json: {
    slot: Slot;
    status?: string;
    text: unknown;
    scope?: string;
    evidence_refs?: string[];
    related_ids?: number[];
    supersedes?: number;
  };
};
type Snapshot = { role: Role; rows: ReplayRow[]; challenges: string[]; padding: number };
type Entry = Pick<WorkbookEntry, 'id' | 'sequence' | 'slot' | 'role' | 'status'>;
type PresentedEntry = {
  id: number;
  slot?: Slot;
  role: string;
  status?: string;
  text?: string;
  scope?: string;
  evidence_refs?: string[];
  truncated?: true;
  evidence_refs_count?: number;
  scope_truncated?: true;
};
type Visible = { entry: Entry; current: PresentedEntry; short?: true };
type Section = { challenge: string; updated: number; entries: Visible[]; collapsed: boolean };
type Omission = 'slot_cap' | 'total_cap';
type Omissions = Map<number, Omission>;
type Render = (sections: Section[], omissions: Omissions) => { coverage: ReturnType<typeof omissionCoverage> };
type Projection = {
  sections: Section[];
  omissions: Omissions;
  render: Render;
  maxChars: number;
};
type ReplayResult = {
  included: number[];
  omitted: number[];
  compressed: number[];
  compressedBeforeDropping: number[];
  collapsed: number;
  chars: number;
  maxChars: number;
};
type P4Coverage = ReturnType<typeof omissionCoverage> & {
  full_ids: number[];
  short_ids: number[];
  capacity_shortfall?: true;
  protected_omitted_ids?: number[];
};
type Policy = {
  drop: (sections: Section[], chars: number, maxChars: number) => Visible | undefined;
  compress?: (current: Visible, role: Role) => PresentedEntry;
  native?: boolean;
};

const bySequence = (a: { sequence: number }, b: { sequence: number }) => a.sequence - b.sequence;
const sortedIds = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b);
const chars = (value: unknown) => JSON.stringify(value).length;
const visible = (sections: Section[]) => sections.filter(s => !s.collapsed).flatMap(s => s.entries);
const visibleIds = (sections: Section[]) => sortedIds(visible(sections).map(v => v.entry.id));
const closed = new Set(['answered', 'dropped', 'withdrawn']);
const openEntries = (rows: ReplayRow[]) => activeEntries(rows).filter(e => !closed.has(e.status ?? ''));
const factsOrRefuted = (slot: Slot) => slot === 'facts' || slot === 'refuted';
const sameIds = (left: number[], right: number[]) =>
  left.length === right.length && left.every((id, i) => id === right[i]);
const omissionCoverage = (omissions: Omissions) => ({
  omitted_ids: sortedIds(omissions.keys()),
  omitted_reasons: Object.fromEntries(omissions),
});

function p4Protected(entry: Entry) {
  switch (entry.slot) {
    case 'candidate': return entry.status === 'proposed';
    case 'hypotheses': return entry.status === 'open' || entry.status === undefined;
    case 'questions': return entry.status === 'open';
    default: return false;
  }
}

function p4Short(entry: Entry, current: PresentedEntry, role: Role): PresentedEntry {
  const { id, slot, role: author } = entry;
  const { status, evidence_refs } = current;
  const identity = { id, slot, role: author, ...(status === undefined ? {} : { status }) };
  if (role === 'coordinator') {
    // Coordinator entries sit in a per-slot list without a slot field; the short row follows the same shape.
    const { slot: _slot, ...coordinatorIdentity } = identity;
    return {
      ...coordinatorIdentity,
      ...((slot === 'hypotheses' || slot === 'candidate') && evidence_refs !== undefined ? { evidence_refs } : {}),
    };
  }
  return {
    ...identity,
    text: Array.from((current.text ?? '').replace(/[\r\n\u2028\u2029]/g, '')).slice(0, 80).join('') + '…',
    truncated: true,
    evidence_refs_count: evidence_refs?.length ?? 0,
    ...(slot === 'refuted' && current.scope !== undefined ? { scope_truncated: true } : {}),
  };
}

function workbookHost(snapshot: Snapshot): WorkbookHost {
  return {
    goal: { challenge: snapshot.challenges[0] ?? '', materials: [], submission: 'x'.repeat(snapshot.padding) },
    candidate_host: { packages: [], completions: [] },
  };
}

function coordinatorInputs(snapshot: Snapshot) {
  const groups = snapshot.challenges.map(id => ({
    id,
    rows: snapshot.rows.filter(row => row.challenge_id === id),
  }));
  // The recorded size can recover the total overhead. For multiple sections,
  // assign the unknown part to the most recent section, which never collapses.
  const mostRecent = [...groups].sort((a, b) => lastUpdate(a.rows) - lastUpdate(b.rows)).at(-1);
  const challenges = groups.map(group => ({
    ...group,
    host: {
      submission: group === mostRecent ? 'x'.repeat(snapshot.padding) : '',
      packages: [], completions: [], executions: {},
    },
  })) satisfies CoordinatorChallenge[];
  const remainingMin = challenges.length > 0 || snapshot.padding === 0 ? 0 : 10 ** snapshot.padding;
  return { challenges, remainingMin };
}

function lastUpdate(rows: ReplayRow[]) {
  return Math.max(0, ...rows.map(row => row.updated_at));
}

function project(snapshot: Snapshot, retainSlotOverflow = false): Projection {
  if (snapshot.role !== 'coordinator') {
    const base = workbookView([], snapshot.role, workbookHost(snapshot)).view;
    const slots = Object.keys(base.slots) as Slot[];
    const active = openEntries(snapshot.rows).filter(e => slots.includes(e.slot));
    const omissions: Omissions = new Map();
    const entries: Visible[] = [];
    for (const slot of slots) {
      const all = active.filter(e => e.slot === slot).sort(bySequence);
      const kept = all.slice(-SLOT_CAPS[slot]);
      for (const entry of all.slice(0, all.length - kept.length)) {
        if (retainSlotOverflow) {
          entries.push({ entry, current: p4Short(entry, entry, snapshot.role), short: true });
        } else {
          omissions.set(entry.id, 'slot_cap');
        }
      }
      for (const entry of kept) {
        const { sequence: _sequence, ...full } = entry;
        entries.push({ entry, current: full });
      }
    }
    const perSlot = (all: Visible[]) => Object.fromEntries(slots.map(slot => [
      slot, all.filter(v => v.entry.slot === slot).map(v => v.current),
    ]));
    const render: Render = ([section], dropped) => {
      const shown = section!.entries;
      return {
        ...base,
        slots: perSlot(shown),
        coverage: {
          ...base.coverage,
          per_slot: Object.fromEntries(slots.map(slot => [slot, {
            active: active.filter(e => e.slot === slot).length,
            presented: shown.filter(v => v.entry.slot === slot).length,
          }])),
          ...omissionCoverage(dropped),
          complete: dropped.size === 0,
        },
      };
    };
    return {
      sections: [{ challenge: snapshot.challenges[0] ?? '', updated: 0, entries, collapsed: false }],
      omissions, render, maxChars: base.coverage.max_chars,
    };
  }

  const { challenges, remainingMin } = coordinatorInputs(snapshot);
  // Unlimited total size keeps the launcher's exact slot caps, cleaning, line
  // truncation, field whitelist and entry serialization before any omissions.
  const base = coordinatorView(challenges, remainingMin, text => redactProgressText(text), Infinity).view;
  const active = challenges.flatMap(c => openEntries(c.rows));
  const byId = new Map(active.map(e => [e.id, e]));
  const omissions = new Map(Object.entries(base.coverage.omitted_reasons)
    .map(([id, reason]) => [Number(id), reason] as const));
  const sections = base.challenges.map((section, index): Section => {
    if (!('slots' in section)) throw new Error('unexpected_unlimited_view_collapse');
    const entries: Visible[] = Object.values(section.slots).flatMap(list => list.map(full => ({
      entry: byId.get(full.id)!, current: full,
    })));
    if (retainSlotOverflow) {
      // The native assembly already checked these rows. Build only the short
      // form of slot overflow, with the same status and ref cleaning.
      for (const entry of openEntries(challenges[index]!.rows)) {
        if (!omissions.delete(entry.id)) continue;
        const { id, slot, role, status } = entry;
        const current = p4Short(entry, {
          id, role, status: slot === 'candidate' ? status : status || undefined,
          evidence_refs: slot === 'hypotheses' || slot === 'candidate'
            ? entry.evidence_refs.map(ref => redactProgressText(ref)) : undefined,
        }, 'coordinator');
        entries.push({ entry, current, short: true });
      }
      entries.sort((a, b) => bySequence(a.entry, b.entry));
    }
    return {
      challenge: section.challenge,
      updated: lastUpdate(challenges[index]!.rows),
      collapsed: false,
      entries,
    };
  });
  const render: Render = (current, dropped) => ({
    ...base,
    challenges: current.map((section, index) => {
      if (section.collapsed) return {
        challenge: section.challenge,
        collapsed: true,
        active: Object.fromEntries(WORKBOOK_SLOTS.map(slot => [
          slot, section.entries.filter(v => v.entry.slot === slot).length,
        ])),
      };
      return {
        ...base.challenges[index],
        slots: Object.fromEntries(WORKBOOK_SLOTS.map(slot => [
          slot, section.entries.filter(v => v.entry.slot === slot).map(v => v.current),
        ])),
      };
    }),
    coverage: {
      ...base.coverage,
      ...omissionCoverage(dropped),
      collapsed: current.filter(s => s.collapsed).map(s => s.challenge),
      max_chars: COORDINATOR_MAX_CHARS,
    },
  });
  return { sections, omissions, render, maxChars: COORDINATOR_MAX_CHARS };
}

function oldest(entries: Visible[]) {
  return entries.sort((a, b) => bySequence(a.entry, b.entry))[0];
}

function chooseByStatus(sections: Section[]) {
  const entries = visible(sections);
  return oldest(entries.filter(v => factsOrRefuted(v.entry.slot)))
    ?? oldest(entries.filter(v => v.entry.slot === 'hypotheses'))
    ?? oldest(entries.filter(v => v.entry.slot === 'questions'));
}

const quotas = [
  { slots: ['hypotheses', 'questions', 'candidate'], share: 0.45 },
  { slots: ['facts'], share: 0.35 },
  { slots: ['refuted'], share: 0.20 },
];

function chooseByQuota(sections: Section[], size: number, maxChars: number) {
  const entries = visible(sections);
  const bySlot = (slots: string[]) => entries.filter(v => slots.includes(v.entry.slot));
  const groups = quotas.map(({ slots, share }) => {
    // Array punctuation is charged per slot and per uncollapsed challenge.
    const cost = sections.filter(s => !s.collapsed).reduce((total, section) => total + slots.reduce(
      (sum, slot) => sum + chars(section.entries.filter(v => v.entry.slot === slot).map(v => v.current)) - 2,
      0,
    ), 0);
    return { entries: bySlot(slots), share, cost };
  });
  const allocatable = Math.max(0, maxChars - (size - groups.reduce((sum, group) => sum + group.cost, 0)));
  const shares = groups.map(group => Math.floor(allocatable * group.share));
  shares[0]! += allocatable - shares.reduce((sum, share) => sum + share, 0);
  let surplus = groups.reduce((sum, group, i) => sum + Math.max(0, shares[i]! - group.cost), 0);
  for (const [i, group] of groups.entries()) {
    const needed = Math.max(0, group.cost - shares[i]!);
    const borrowed = Math.min(surplus, needed);
    surplus -= borrowed;
    if (borrowed < needed) return oldest(group.entries);
  }
  return undefined;
}

const policies = {
  P0: { native: true, drop: sections => oldest(visible(sections)) },
  P1: { drop: chooseByStatus },
  P2: {
    drop: chooseByStatus,
    compress: ({ entry, current }, role) => ({
      id: entry.id, slot: entry.slot, role: entry.role,
      ...(role === 'coordinator' ? {} : {
        text: (current.text ?? '').slice(0, 80) + '…', evidence_refs_count: current.evidence_refs?.length ?? 0,
      }),
    }),
  },
  P3: { drop: chooseByQuota },
} satisfies Record<string, Policy>;
type LegacyPolicyName = keyof typeof policies;
type PolicyName = LegacyPolicyName | 'P4';

function replay(snapshot: Snapshot, policy: Policy, testCap?: number): ReplayResult {
  const uncompressed = { compressed: [], compressedBeforeDropping: [] };
  if (policy.native && testCap === undefined) {
    if (snapshot.role === 'coordinator') {
      const { challenges, remainingMin } = coordinatorInputs(snapshot);
      const result = coordinatorView(challenges, remainingMin, text => redactProgressText(text));
      return {
        ...uncompressed, included: result.included_ids, omitted: result.view.coverage.omitted_ids,
        collapsed: result.view.coverage.collapsed.length, chars: result.chars, maxChars: COORDINATOR_MAX_CHARS,
      };
    }
    const result = workbookView(snapshot.rows, snapshot.role, workbookHost(snapshot));
    return {
      ...uncompressed, included: result.included_ids, omitted: result.omitted_ids, collapsed: 0,
      chars: result.chars, maxChars: result.view.coverage.max_chars,
    };
  }

  const { sections, omissions, render, maxChars } = project(snapshot);
  const cap = testCap ?? maxChars;
  let size = chars(render(sections, omissions));
  // Same challenge collapse order as the launcher before applying entry rules.
  for (const section of [...sections].sort((a, b) => a.updated - b.updated).slice(0, -1)) {
    if (size <= cap) break;
    section.collapsed = true;
    size = chars(render(sections, omissions));
  }

  const compressedBeforeDropping: number[] = [];
  const compress = policy.compress;
  if (compress) {
    const candidates = visible(sections).filter(v => factsOrRefuted(v.entry.slot))
      .sort((a, b) => bySequence(a.entry, b.entry));
    for (const row of candidates) {
      if (size <= cap) break;
      row.current = compress(row, snapshot.role);
      row.short = true;
      compressedBeforeDropping.push(row.entry.id);
      size = chars(render(sections, omissions));
    }
  }

  while (size > cap) {
    const drop = policy.drop(sections, size, cap);
    if (!drop) break;
    const section = sections.find(s => s.entries.includes(drop))!;
    section.entries = section.entries.filter(v => v !== drop);
    omissions.set(drop.entry.id, 'total_cap');
    size = chars(render(sections, omissions));
  }
  return {
    included: visibleIds(sections), omitted: sortedIds(omissions.keys()),
    compressed: sortedIds(visible(sections).filter(v => v.short).map(v => v.entry.id)),
    compressedBeforeDropping, collapsed: sections.filter(s => s.collapsed).length,
    chars: size, maxChars: cap,
  };
}

function replayP4(snapshot: Snapshot, testCap?: number): ReplayResult & { view: { coverage: P4Coverage } } {
  const { sections, omissions, render, maxChars } = project(snapshot, true);
  const cap = testCap ?? maxChars;
  const protectedOmitted: number[] = [];
  const compressedBeforeDropping = visible(sections).filter(v => v.short).map(v => v.entry.id);
  const build = () => {
    const base = render(sections, omissions);
    const entries = visible(sections);
    const coverage: P4Coverage = {
      ...base.coverage,
      full_ids: sortedIds(entries.filter(v => !v.short).map(v => v.entry.id)),
      short_ids: sortedIds(entries.filter(v => v.short).map(v => v.entry.id)),
      ...(protectedOmitted.length ? {
        capacity_shortfall: true, protected_omitted_ids: sortedIds(protectedOmitted),
      } : {}),
    };
    return { ...base, coverage };
  };
  let view = build();
  let size = chars(view);
  const groups = [
    (entry: Entry) => factsOrRefuted(entry.slot),
    (entry: Entry) => (entry.slot === 'hypotheses' || entry.slot === 'questions') && !p4Protected(entry),
    p4Protected,
  ];
  // Keep every challenge in the pressure ordering. Collapsing one first could
  // hide protected IDs before their short rows reach the last drop tier.
  const ordered = sections.flatMap(section => section.entries.map(row => ({ section, row })))
    .sort((a, b) => bySequence(a.row.entry, b.row.entry));
  for (const drop of [false, true]) {
    for (const inGroup of groups) {
      for (const { section, row } of ordered) {
        if (size <= cap) break;
        if (Boolean(row.short) !== drop || !inGroup(row.entry)) continue;
        if (drop) {
          section.entries = section.entries.filter(v => v !== row);
          omissions.set(row.entry.id, 'total_cap');
          if (p4Protected(row.entry)) protectedOmitted.push(row.entry.id);
        } else {
          row.current = p4Short(row.entry, row.current, snapshot.role);
          row.short = true;
          compressedBeforeDropping.push(row.entry.id);
        }
        view = build();
        size = chars(view);
      }
    }
  }
  return {
    view, chars: size, maxChars: cap, collapsed: 0,
    included: sortedIds([...view.coverage.full_ids, ...view.coverage.short_ids]),
    omitted: view.coverage.omitted_ids,
    compressed: view.coverage.short_ids,
    compressedBeforeDropping,
  };
}

type WorkbookAudit = {
  included_ids: number[];
  omitted_ids: number[];
  chars: number;
  challenges?: string[];
  collapsed?: string[];
  failed_ids?: number[];
  truncated_ids?: number[];
};
type AuditEvent = {
  op: string;
  seq: number;
  role: Role;
  detail?: { challenge?: string; workbook?: WorkbookAudit };
};
type Observation = {
  seq: number;
  role: Role;
  audit: WorkbookAudit;
  snapshot: Snapshot;
  padding?: number;
};
type Difference = {
  run: string;
  seq: number;
  role: Role;
  reasons: string[];
  missingRows?: number;
  recordedChars?: number;
  replayChars?: number;
};
type Validation = { total: number; matched: number; unverifiable: number; mismatches: Difference[] };

function calibrate(observation: Observation) {
  const { snapshot, audit } = observation;
  const { sections, omissions, render } = project(snapshot);
  // No row IDs in a historically collapsed section can be recovered from the
  // two audit lists. Use an independent estimate there and record the gap.
  if (audit.collapsed?.length || audit.failed_ids?.length) return undefined;
  const wanted = new Set(audit.included_ids);
  for (const section of sections) section.entries = section.entries.filter(v => wanted.has(v.entry.id));
  if (!sameIds(visibleIds(sections), audit.included_ids)) return undefined;
  const observedOmissions: Omissions = new Map(audit.omitted_ids.map(id => [
    id, omissions.get(id) ?? 'total_cap',
  ]));
  const padding = audit.chars - chars(render(sections, observedOmissions));
  if (padding < 0 || (snapshot.challenges.length === 0 && padding > 6)) return undefined;
  return padding;
}

function replayDifference(run: string, observation: Observation, result: ReplayResult): Difference | undefined {
  const { seq, role, audit } = observation;
  const reasons = [];
  if (!sameIds(result.included, audit.included_ids)) reasons.push('included_ids_differ');
  if (!sameIds(result.omitted, audit.omitted_ids)) reasons.push('omitted_ids_differ');
  if ((audit.collapsed?.length ?? 0) !== result.collapsed) reasons.push('collapsed_challenge_count_differs');
  if (!reasons.length) return undefined;
  return { run, seq, role, reasons, recordedChars: audit.chars, replayChars: result.chars };
}

function stress(snapshot: Snapshot, idOffset: number): Snapshot {
  const sequenceOffset = Math.max(0, ...snapshot.rows.map(row => row.sequence));
  const originalIds = new Set(snapshot.rows.map(row => row.id));
  return {
    ...snapshot,
    rows: [...snapshot.rows, ...snapshot.rows.map(row => ({
      ...row,
      id: row.id + idOffset,
      sequence: row.sequence + sequenceOffset,
      note_json: {
        ...row.note_json,
        supersedes: originalIds.has(row.note_json.supersedes ?? 0)
          ? row.note_json.supersedes! + idOffset : row.note_json.supersedes,
      },
    }))],
  };
}

const statusLabels = new Set(['open', 'supported', 'refuted', 'answered', 'dropped', 'proposed', 'withdrawn']);
const authorLabels = new Set([...roles, 'intake', 'engineer', 'verifier', 'solver']);
const variants = ['real', 'double_entries'] as const;
type Variant = typeof variants[number];
const ruleEntries = Object.entries(policies) as [LegacyPolicyName, Policy][];
const policyNames = [...ruleEntries.map(([name]) => name), 'P4'] as const;
const comparisonNames = ['P0', 'P2', 'P4'] as const;
const reconFactRuns = ['p1-Bad_Traveling-r1', 'p2-ac5a1bc0-b2'] as const;
type Classification = Pick<WorkbookEntry, 'slot' | 'role' | 'status'>;
class Metrics {
  private readonly dropped = new Map<string, Classification>();
  private readonly compressed = new Set<string>();
  private readonly attemptedCompression = new Set<string>();
  total = 0;
  withDrops = 0;
  withAllVisible = 0;
  overCap = 0;
  peakChars = 0;
  fullRows = 0;
  shortRows = 0;
  activeRows = 0;

  observe(run: string, active: WorkbookEntry[], result: ReplayResult) {
    const key = (id: number) => JSON.stringify([run, id]);
    const included = new Set(result.included);
    // Compare to the input, since a Coordinator challenge collapse also hides
    // IDs, while its coverage.omitted_ids lists only cap removals.
    const dropped = active.filter(entry => !included.has(entry.id));
    this.total++;
    this.withDrops += Number(dropped.length > 0);
    this.withAllVisible += Number(dropped.length === 0);
    this.peakChars = Math.max(this.peakChars, result.chars);
    this.overCap += Number(result.chars > result.maxChars);
    this.fullRows += result.included.length - result.compressed.length;
    this.shortRows += result.compressed.length;
    this.activeRows += active.length;
    for (const { id, slot, status, role } of dropped) this.dropped.set(key(id), { slot, status, role });
    for (const id of result.compressed) this.compressed.add(key(id));
    for (const id of result.compressedBeforeDropping) this.attemptedCompression.add(key(id));
  }

  comparison() {
    return {
      full_rows: this.fullRows,
      short_rows: this.shortRows,
      active_rows: this.activeRows,
      visible_ids_ratio: ratio(this.fullRows + this.shortRows, this.activeRows),
      presentations_all_ids_visible: this.withAllVisible,
      all_ids_visible_ratio: ratio(this.withAllVisible, this.total),
      peak_chars: this.peakChars,
    };
  }

  report() {
    const dropped = [...this.dropped.values()];
    const countBy = (label: (row: Classification) => string) => {
      const counts = new Map<string, number>();
      for (const row of dropped) {
        const name = label(row);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
    };
    return {
      presentations: this.total,
      presentations_with_drops: this.withDrops,
      distinct_dropped: dropped.length,
      dropped_by_slot: countBy(row => row.slot),
      dropped_by_status: countBy(row => row.status === undefined ? 'none' : statusLabels.has(row.status) ? row.status : 'other'),
      dropped_by_author_role: countBy(row => authorLabels.has(row.role) ? row.role : 'other'),
      dropped_open_hypotheses: dropped.filter(row => row.slot === 'hypotheses' && row.status === 'open').length,
      dropped_open_questions: dropped.filter(row => row.slot === 'questions' && row.status === 'open').length,
      distinct_compressed_visible: this.compressed.size,
      distinct_compressed_before_dropping: this.attemptedCompression.size,
      presentations_all_ids_visible: this.withAllVisible,
      all_ids_visible_ratio: ratio(this.withAllVisible, this.total),
      peak_chars: this.peakChars,
      presentations_over_cap: this.overCap,
    };
  }
}

const ratio = (n: number, d: number) => d === 0 ? null : n / d;
const emptyValidation = (): Validation => ({ total: 0, matched: 0, unverifiable: 0, mismatches: [] });
const reportValidation = (counts: Validation) => ({ ...counts, match_ratio: ratio(counts.matched, counts.total) });
const runsDirectory = '/Users/caihaoming/Documents/pentest-agent-run-data/candidate-baseline-20261119-p1/runs';
const summaryPath = fileURLToPath(new URL('../../docs/gates/workbook-omission-20261119/summary.json', import.meta.url));
type StoredRow = Omit<ReplayRow, 'note_json'> & { note: string };

function loadRows(path: string, ids: Set<number>) {
  // A finished, checkpointed store can be opened without writing WAL/SHM
  // sidecars in the external run directory.
  if ((statSync(path + '-wal', { throwIfNoEntry: false })?.size ?? 0) > 0) {
    throw new Error('uncheckpointed_sqlite');
  }
  const db = new DatabaseSync(pathToFileURL(path).href + '?immutable=1', { readOnly: true });
  try {
    const select = db.prepare(`
      SELECT id, sequence, role, kind, challenge_id, updated_at,
        json_object('slot', note_json -> '$.slot', 'status', note_json -> '$.status',
          'text', note_json -> '$.text', 'scope', note_json -> '$.scope',
          'evidence_refs', note_json -> '$.evidence_refs', 'related_ids', note_json -> '$.related_ids',
          'supersedes', note_json -> '$.supersedes') AS note
      FROM recon_turns WHERE id = ?
    `);
    const rows = new Map<number, ReplayRow>();
    for (const id of ids) {
      const record = select.get(id) as StoredRow | undefined;
      if (!record) continue;
      const { note, ...row } = record;
      rows.set(id, { ...row, note_json: JSON.parse(note) });
    }
    return rows;
  } finally {
    db.close();
  }
}

function activeForMetrics(snapshot: Snapshot) {
  return snapshot.challenges.flatMap(challenge => openEntries(snapshot.rows.filter(row => row.challenge_id === challenge)))
    .filter(entry => snapshot.role !== 'recon' || entry.slot !== 'candidate');
}

const emptyP4Counts = () => ({
  short_ids_checked: 0, short_ids_resolved: 0, protected_drops: 0, marked_protected_drops: 0,
  shortfall_presentations: 0, marked_shortfall_presentations: 0,
});

/**
 * Production view (the 2026-11-19 omission rule) on one snapshot. Its guidance text is longer than the frozen legacy one
 * the P4 reference renders with, so equivalence runs P4 with the cap reduced by exactly that difference.
 */
function replayProd(snapshot: Snapshot) {
  if (snapshot.role === 'coordinator') {
    const { challenges, remainingMin } = coordinatorInputs(snapshot);
    const r = prodCoordinatorView(challenges, remainingMin, text => redactProgressText(text)) as any;
    return { full: r.view.coverage.full_ids as number[], short: r.view.coverage.short_ids as number[],
      omitted: r.view.coverage.omitted_ids as number[], chars: r.chars as number, shortfall: Boolean(r.capacity_shortfall) };
  }
  const r = prodWorkbookView(snapshot.rows, snapshot.role, workbookHost(snapshot)) as any;
  return { full: r.view.coverage.full_ids as number[], short: r.view.coverage.short_ids as number[],
    omitted: r.omitted_ids as number[], chars: r.chars as number, shortfall: Boolean(r.capacity_shortfall) };
}
function guidanceDelta(snapshot: Snapshot) {
  const len = (v: unknown) => JSON.stringify(v).length;
  if (snapshot.role === 'coordinator') {
    return len((prodCoordinatorView([], 0, t => t) as any).view.guidance) - len((coordinatorView([], 0, t => t) as any).view.guidance);
  }
  const host = workbookHost(snapshot);
  return len((prodWorkbookView([], snapshot.role, host) as any).view.guidance) - len((workbookView([], snapshot.role, host) as any).view.guidance);
}

function main() {
  const runs = readdirSync(runsDirectory, { withFileTypes: true })
    .filter(dir => dir.isDirectory() && /^p[12]-[\w.-]+$/.test(dir.name)).map(dir => dir.name).sort();
  const batchRuns = {
    p1: runs.filter(run => run.startsWith('p1-')).length,
    p2: runs.filter(run => run.startsWith('p2-')).length,
  };
  if (batchRuns.p1 !== 14 || batchRuns.p2 !== 12) throw new Error('unexpected_batch_run_counts');

  const metrics = new Map<string, Metrics>();
  const metric = (variant: Variant, name: PolicyName, role: Role) => {
    const key = [variant, name, role].join('/');
    let counts = metrics.get(key);
    if (!counts) {
      counts = new Metrics();
      metrics.set(key, counts);
    }
    return counts;
  };
  const validation = new Map(roles.map(role => [role, emptyValidation()]));
  const independent = emptyValidation();
  const projectionCheck = emptyValidation();
  const multiChallenge: { run: string; seq: number; challengeCount: number }[] = [];
  const prodEquivalence = new Map(variants.map(variant => [variant, {
    total: 0, sets_matched: 0, chars_matched: 0, over_cap: 0, shortfall: 0,
    mismatches: [] as { run: string; seq: number; role: Role; setsMatch: boolean; prodChars: number; refChars: number }[],
  }]));
  const p4Counts = new Map(variants.map(variant => [variant, {
    byRole: new Map(roles.map(role => [role, emptyP4Counts()])),
    shortfalls: [] as { run: string; seq: number; role: Role; protected_drops: number; marked: boolean; by_slot: Partial<Record<Slot, number>> }[],
  }]));
  const reconFacts = new Map<string, Map<Role, { active: number; P0: number; P4: number }>>(
    reconFactRuns.map(run => [run, new Map(roles.map(role => [role, { active: 0, P0: 0, P4: 0 }]))]),
  );
  let paddingFallbacks = 0;
  let recordedCharMatches = 0;

  for (const run of runs) {
    const dir = join(runsDirectory, run);
    let events: AuditEvent[];
    let rows: Map<number, ReplayRow>;
    try {
      events = (JSON.parse(readFileSync(join(dir, run, 'evidence/control-audit.json'), 'utf8')) as AuditEvent[])
        .filter(event => event.op === 'context.presented' && roles.includes(event.role));
      const ids = new Set(events.flatMap(event => {
        const audit = event.detail?.workbook;
        return audit ? [...audit.included_ids, ...audit.omitted_ids] : [];
      }));
      rows = loadRows(join(dir, 'experience.sqlite'), ids);
    } catch (error) {
      // Errors can quote input values, so print only safe location and stage.
      const stage = error instanceof Error && error.message === 'uncheckpointed_sqlite'
        ? 'uncheckpointed_sqlite' : 'audit_or_sqlite_read_failed';
      throw new Error(`${stage} (${run})`);
    }
    const idOffset = Math.max(0, ...rows.keys());
    const observations: Observation[] = [];
    for (const event of events) {
      const { seq, role } = event;
      const audit = event.detail?.workbook;
      const counts = validation.get(role)!;
      counts.total++;
      if (!audit) {
        counts.unverifiable++;
        counts.mismatches.push({ run, seq, role, reasons: ['missing_workbook'] });
        continue;
      }
      const ids = [...new Set([...audit.included_ids, ...audit.omitted_ids])];
      const selected = ids.flatMap(id => {
        const row = rows.get(id);
        return row ? [row] : [];
      });
      if (selected.length !== ids.length) {
        counts.unverifiable++;
        counts.mismatches.push({ run, seq, role, reasons: ['missing_sqlite_rows'], missingRows: ids.length - selected.length });
        continue;
      }
      const challenges = role === 'coordinator'
        ? audit.challenges ?? [...new Set(selected.map(row => row.challenge_id))]
        : [event.detail?.challenge ?? selected[0]?.challenge_id ?? ''];
      if (challenges.length > 1) multiChallenge.push({ run, seq, challengeCount: challenges.length });
      if (selected.some(row => !challenges.includes(row.challenge_id))) {
        counts.unverifiable++;
        counts.mismatches.push({ run, seq, role, reasons: ['row_challenge_outside_presentation'] });
        continue;
      }
      const snapshot = { role, rows: selected.sort((a, b) => bySequence(a, b) || a.id - b.id), challenges, padding: 0 };
      const observation: Observation = { seq, role, audit, snapshot };
      observation.padding = calibrate(observation);
      observations.push(observation);
    }

    for (const observation of observations) {
      const { seq, role, audit, snapshot } = observation;
      const counts = validation.get(role)!;
      let near: Observation | undefined;
      if (audit.omitted_ids.length || observation.padding === undefined) {
        near = observations.filter(other => other !== observation && other.padding !== undefined
          && other.role === role && other.audit.omitted_ids.length === 0
          && JSON.stringify(other.snapshot.challenges) === JSON.stringify(snapshot.challenges))
          .sort((a, b) => Math.abs(a.seq - seq) - Math.abs(b.seq - seq) || a.seq - b.seq)[0];
      }
      if (audit.omitted_ids.length) {
        independent.total++;
        if (near?.padding !== undefined) {
          const check = replay({ ...snapshot, padding: near.padding }, policies.P0);
          const difference = replayDifference(run, observation, check);
          if (difference) independent.mismatches.push(difference);
          else independent.matched++;
        } else {
          independent.unverifiable++;
          independent.mismatches.push({ run, seq, role, reasons: ['no_nearby_full_visibility_snapshot'] });
        }
      }

      if (observation.padding === undefined) paddingFallbacks++;
      snapshot.padding = observation.padding ?? near?.padding ?? 0;
      const p0 = replay(snapshot, policies.P0);
      recordedCharMatches += Number(p0.chars === audit.chars);
      const difference = replayDifference(run, observation, p0);
      const gaps = [
        ...(observation.padding === undefined ? ['recorded_size_could_not_calibrate_host'] : []),
        ...(audit.collapsed?.length ? ['historically_collapsed_ids_unavailable'] : []),
        ...(audit.failed_ids?.length ? ['historically_failed_ids_outside_input'] : []),
      ];
      if (difference || gaps.length) {
        if (gaps.length) counts.unverifiable++;
        counts.mismatches.push({
          run, seq, role, reasons: [...gaps, ...(difference?.reasons ?? [])],
          recordedChars: audit.chars, replayChars: p0.chars,
        });
      } else {
        counts.matched++;
      }
      for (const variant of variants) {
        const input = variant === 'real' ? snapshot : stress(snapshot, idOffset);
        const active = activeForMetrics(input);
        for (const [name, policy] of ruleEntries) {
          const result = variant === 'real' && name === 'P0' ? p0 : replay(input, policy);
          metric(variant, name, role).observe(run, active, result);
          if (name === 'P0') {
            // Hold the drop rule constant to compare the candidate assembler
            // with the native one, including the length of omission metadata.
            const projected = replay(input, { drop: policy.drop });
            projectionCheck.total++;
            if (projected.chars === result.chars && projected.collapsed === result.collapsed
              && sameIds(projected.included, result.included) && sameIds(projected.omitted, result.omitted)) {
              projectionCheck.matched++;
            } else {
              projectionCheck.mismatches.push({
                run, seq, role, reasons: [`candidate_assembler_differs_on_${variant}`],
                recordedChars: result.chars, replayChars: projected.chars,
              });
            }
          }
        }
        const p4 = replayP4(input);
        metric(variant, 'P4', role).observe(run, active, p4);
        {
          const prod = replayProd(input);
          const offset = guidanceDelta(input);
          const ref = replayP4(input, p4.maxChars - offset);
          const eq = prodEquivalence.get(variant)!;
          eq.total++;
          const setsMatch = sameIds(prod.full, ref.view.coverage.full_ids) && sameIds(prod.short, ref.view.coverage.short_ids)
            && sameIds(prod.omitted, ref.view.coverage.omitted_ids) && prod.shortfall === Boolean(ref.view.coverage.capacity_shortfall);
          const charsMatch = prod.chars === ref.chars + offset;
          if (setsMatch) eq.sets_matched++;
          if (charsMatch) eq.chars_matched++;
          if (prod.chars > p4.maxChars) eq.over_cap++;
          if (prod.shortfall) eq.shortfall++;
          if ((!setsMatch || !charsMatch) && eq.mismatches.length < 20) eq.mismatches.push({ run, seq, role, setsMatch, prodChars: prod.chars, refChars: ref.chars + offset });
        }
        const { coverage } = p4.view;
        const { byRole, shortfalls } = p4Counts.get(variant)!;
        const observed = byRole.get(role)!;
        for (const id of coverage.short_ids) {
          // Stress IDs above the original maximum refer to copies.
          const originalId = variant === 'double_entries' && id > idOffset ? id - idOffset : id;
          observed.short_ids_checked++;
          observed.short_ids_resolved += Number(rows.has(originalId));
        }
        const protectedDrops = active.filter(entry => p4Protected(entry) && coverage.omitted_reasons[entry.id] === 'total_cap');
        if (protectedDrops.length) {
          const marked = coverage.capacity_shortfall === true
            && sameIds(coverage.protected_omitted_ids ?? [], sortedIds(protectedDrops.map(entry => entry.id)));
          observed.protected_drops += protectedDrops.length;
          observed.marked_protected_drops += marked ? protectedDrops.length : 0;
          observed.shortfall_presentations++;
          observed.marked_shortfall_presentations += Number(marked);
          const bySlot: Partial<Record<Slot, number>> = {};
          for (const { slot } of protectedDrops) bySlot[slot] = (bySlot[slot] ?? 0) + 1;
          shortfalls.push({ run, seq, role, protected_drops: protectedDrops.length, marked, by_slot: bySlot });
        }
        const facts = reconFacts.get(run)?.get(role);
        if (variant === 'real' && facts) {
          const activeFacts = active.filter(entry => entry.slot === 'facts' && entry.role === 'recon');
          const p0Visible = new Set(p0.included);
          const p4Visible = new Set(p4.included);
          facts.active += activeFacts.length;
          facts.P0 += activeFacts.filter(entry => p0Visible.has(entry.id)).length;
          facts.P4 += activeFacts.filter(entry => p4Visible.has(entry.id)).length;
        }
      }
    }
  }

  const overall = [...validation.values()].reduce((totals, role) => {
    totals.total += role.total;
    totals.matched += role.matched;
    totals.unverifiable += role.unverifiable;
    totals.mismatches.push(...role.mismatches);
    return totals;
  }, emptyValidation());
  overall.mismatches.sort((a, b) => a.run.localeCompare(b.run) || a.seq - b.seq);
  const results = Object.fromEntries(variants.map(variant => [variant, Object.fromEntries(
    policyNames.map(name => [name, Object.fromEntries(roles.map(role => [role, metric(variant, name, role).report()]))]),
  )]));
  const comparison = Object.fromEntries(variants.map(variant => [variant, Object.fromEntries(
    comparisonNames.map(name => [name, Object.fromEntries(roles.map(role => [role, metric(variant, name, role).comparison()]))]),
  )]));
  const p4ByVariant = Object.fromEntries(variants.map(variant => {
    const { byRole, shortfalls } = p4Counts.get(variant)!;
    const sum = (key: keyof ReturnType<typeof emptyP4Counts>) =>
      [...byRole.values()].reduce((total, counts) => total + counts[key], 0);
    return [variant, {
      presentations: roles.reduce((n, role) => n + metric(variant, 'P4', role).total, 0),
      over_cap: roles.reduce((n, role) => n + metric(variant, 'P4', role).overCap, 0),
      protected_drops: sum('protected_drops'),
      marked_protected_drops: sum('marked_protected_drops'),
      shortfall_presentations: sum('shortfall_presentations'),
      marked_shortfall_presentations: sum('marked_shortfall_presentations'),
      short_ids_checked: sum('short_ids_checked'),
      short_ids_resolved: sum('short_ids_resolved'),
      short_id_resolution_ratio: ratio(sum('short_ids_resolved'), sum('short_ids_checked')),
      by_role: Object.fromEntries(byRole),
      shortfalls,
    }];
  }));
  const factRates = ({ active, P0, P4 }: { active: number; P0: number; P4: number }) => ({
    active, P0_visible: P0, P4_visible: P4, P0_ratio: ratio(P0, active), P4_ratio: ratio(P4, active),
  });
  const reconFactVisibility = Object.fromEntries([...reconFacts].map(([run, byRole]) => {
    const totals = [...byRole.values()].reduce((sum, counts) => ({
      active: sum.active + counts.active, P0: sum.P0 + counts.P0, P4: sum.P4 + counts.P4,
    }), { active: 0, P0: 0, P4: 0 });
    return [run, {
      ...factRates(totals), improved: totals.active > 0 && totals.P4 > totals.P0,
      by_role: Object.fromEntries([...byRole].map(([role, counts]) => [role, factRates(counts)])),
    }];
  }));
  const real = p4ByVariant.real!;
  const double = p4ByVariant.double_entries!;
  const thresholds = {
    zero_over_cap: real.over_cap === 0 && double.over_cap === 0,
    protected_drops: real.protected_drops === 0
      && double.protected_drops === double.marked_protected_drops,
    short_ids_resolve: real.short_id_resolution_ratio === 1 && double.short_id_resolution_ratio === 1,
    recon_fact_visibility_improves: reconFactRuns.every(run => reconFactVisibility[run]?.improved),
  };
  const summary = {
    runs: { total: runs.length, ...batchRuns },
    p0: {
      ...reportValidation(overall),
      recorded_chars_matched: recordedCharMatches,
      by_role: Object.fromEntries([...validation].map(([role, counts]) => [role, {
        total: counts.total, matched: counts.matched, unverifiable: counts.unverifiable,
        match_ratio: ratio(counts.matched, counts.total),
      }])),
      independent_host_check_on_omitting_presentations: reportValidation(independent),
    },
    reconstruction: {
      host_padding_fallbacks: paddingFallbacks,
      multi_challenge_presentations: multiChallenge.length,
      multi_challenge_locations: multiChallenge,
      candidate_assembler_against_native_p0: reportValidation(projectionCheck),
    },
    results,
    comparison,
    p4_acceptance: { thresholds, by_variant: p4ByVariant, recon_fact_visibility_real: reconFactVisibility },
    p4_prod_equivalence: {
      note: 'Production workbookView/coordinatorView (2026-11-19 omission rule) against the P4 reference with the cap reduced by the guidance-length difference; legacy P0 now reads the frozen tests/manual/workbook-legacy-view.ts.',
      by_variant: Object.fromEntries(prodEquivalence),
    },
  };
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', { mode: 0o644 });
  chmodSync(summaryPath, 0o644);

  console.log(`P0 audit IDs ${overall.matched}/${overall.total}. Independent host estimate ${independent.matched}/${independent.total} on omitting presentations.`);
  for (const [check, mismatches] of [
    ['P0', overall.mismatches], ['P0 independent host', independent.mismatches], ['Candidate assembler', projectionCheck.mismatches],
  ] as const) {
    for (const { run, seq, role, reasons } of mismatches) console.log(check, run, seq, role, reasons.join(', '));
  }
  console.table(variants.flatMap(variant => policyNames.flatMap(name => roles.map(role => {
    const counted = metric(variant, name, role).report();
    return {
      variant, rule: name, role, dropped: `${counted.presentations_with_drops}/${counted.presentations}`,
      distinct: counted.distinct_dropped, open_hyp: counted.dropped_open_hypotheses,
      open_q: counted.dropped_open_questions, compressed: counted.distinct_compressed_visible,
      all_visible: counted.all_ids_visible_ratio === null ? null : `${(100 * counted.all_ids_visible_ratio).toFixed(2)}%`,
      peak_chars: counted.peak_chars,
    };
  }))));
  console.log('P4 thresholds', JSON.stringify(thresholds));
  if (overall.matched !== overall.total || projectionCheck.matched !== projectionCheck.total
    || Object.values(thresholds).some(passed => !passed)) process.exitCode = 1;
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error && /^(?:audit_or_sqlite_read_failed \(p[12]-[\w.-]+\)|uncheckpointed_sqlite \(p[12]-[\w.-]+\)|unexpected_batch_run_counts)$/.test(error.message)
      ? error.message : 'workbook replay failed';
    console.error(message);
    process.exitCode = 1;
  }
}
