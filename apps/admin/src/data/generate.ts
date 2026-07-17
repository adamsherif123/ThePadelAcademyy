import {
  ID_PREFIXES,
  cairoCalendarDate,
  materializeTemplateSlot,
  newId,
  parseInstant,
  templateRequiresGenderLevel,
} from '@tpa/core';
import type {
  AvailabilityTemplate,
  CoachId,
  Gender,
  IsoInstant,
  Level,
  SessionSlot,
  SlotId,
  TrainingType,
  Weekday,
} from '@tpa/types';

import { findCoachConflict } from './schedule';
import { commitNewSlots, getSlots, getTemplates } from './store';

/**
 * "Generate slots" — the most consequential action in the admin — as a PURE,
 * side-effect-free planner (`generateSlots`) plus an explicit commit
 * (`commitGeneration`). Nothing is written until the admin confirms a preview, and
 * the write is purely additive, so it can never mutate a session that already
 * exists — least of all a booked one.
 *
 * S10 replaces both bodies with a single `generate_slots(range)` RPC: the planner
 * becomes a server-side dry run (returns the same preview), and commitGeneration
 * becomes the bulk INSERT the RPC performs on confirm. The identity rule below
 * (templateId + Cairo date) becomes a UNIQUE index so idempotency is enforced by
 * the database, not just previewed here.
 */

const DAY_MS = 86_400_000;
const ms = (i: IsoInstant): number => parseInstant(i).getTime();
const overlaps = (aStart: IsoInstant, aEnd: IsoInstant, bStart: IsoInstant, bEnd: IsoInstant): boolean =>
  ms(aStart) < ms(bEnd) && ms(bStart) < ms(aEnd); // touching boundaries do NOT overlap

/** A Cairo calendar date, the unit generation iterates over (never an instant). */
interface CairoDate {
  year: number;
  month: number;
  day: number;
}

/** An inclusive Cairo calendar-date range, as the date pickers produce it. */
export interface GenerateRange {
  /** 'YYYY-MM-DD' Cairo date, inclusive. */
  fromDate: string;
  /** 'YYYY-MM-DD' Cairo date, inclusive. */
  toDate: string;
}

export type SkipReason = 'already_exists' | 'in_past' | 'coach_conflict';

export interface PlannedSlot {
  slot: SessionSlot;
  template: AvailabilityTemplate;
  /** 'YYYY-MM-DD' Cairo date — for grouping the preview by day. */
  date: string;
}

export interface SkippedSlot {
  template: AvailabilityTemplate;
  /** 'YYYY-MM-DD' Cairo date the slot would have fallen on. */
  date: string;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
  reason: SkipReason;
  /** For coach_conflict: the start of the slot it clashes with. */
  conflictWith?: IsoInstant;
}

export interface GenerationPlan {
  range: GenerateRange;
  toCreate: PlannedSlot[];
  skipped: SkippedSlot[];
}

const pad = (n: number): string => String(n).padStart(2, '0');
const dateKey = (d: CairoDate): string => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

/**
 * A slot's IDENTITY for generation: the template it came from + the Cairo calendar
 * date it lands on. Re-running generation for the same (template, date) must be a
 * no-op, so this key — NOT the random slot id — is what "already exists" is checked
 * against. Any status counts (a cancelled session still occupied that date; we
 * don't resurrect it). One-offs have templateId null and so never collide.
 */
function identityKey(templateId: string, d: CairoDate): string {
  return `${templateId}|${dateKey(d)}`;
}

function slotIdentityKey(slot: SessionSlot): string | null {
  if (slot.templateId === null) return null;
  const c = cairoCalendarDate(slot.startsAt);
  return `${slot.templateId}|${c.year}-${pad(c.month)}-${pad(c.day)}`;
}

function parseCairoDate(iso: string): CairoDate | null {
  const [y, m, d] = iso.split('-').map(Number);
  if (![y, m, d].every((n) => Number.isFinite(n))) return null;
  return { year: y!, month: m!, day: d! };
}

/** Every Cairo calendar date in [fromDate, toDate] inclusive (empty if inverted). */
function eachDate(range: GenerateRange): { date: CairoDate; weekday: Weekday }[] {
  const from = parseCairoDate(range.fromDate);
  const to = parseCairoDate(range.toDate);
  if (!from || !to) return [];
  const startUtc = Date.UTC(from.year, from.month - 1, from.day);
  const endUtc = Date.UTC(to.year, to.month - 1, to.day);
  if (endUtc < startUtc) return [];
  const out: { date: CairoDate; weekday: Weekday }[] = [];
  for (let t = startUtc; t <= endUtc; t += DAY_MS) {
    const d = new Date(t);
    out.push({
      date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
      weekday: d.getUTCDay() as Weekday,
    });
  }
  return out;
}

/**
 * Plan a generation run WITHOUT writing anything. Walks the date range in order,
 * and for each ACTIVE template whose weekday matches, decides create-or-skip:
 *  - already a slot for this (template, Cairo date)  → skip 'already_exists' (idempotent);
 *  - the start is at/*before* `now`                  → skip 'in_past' (never backfill);
 *  - the coach already has an overlapping session     → skip 'coach_conflict' (they
 *    can't be in two places), checked against BOTH existing published slots AND
 *    slots already planned earlier in THIS run — so the conflict is surfaced in the
 *    preview rather than exploding the whole batch.
 * Only active templates are considered, and a weekday only has active templates on
 * "open" days, so "open days only" falls out for free.
 */
export function generateSlots(range: GenerateRange, now: IsoInstant): GenerationPlan {
  const templates = getTemplates().filter((t) => t.isActive);
  const existing = getSlots();
  const existingKeys = new Set(existing.map(slotIdentityKey).filter((k): k is string => k !== null));
  const nowMs = ms(now);

  const toCreate: PlannedSlot[] = [];
  const skipped: SkippedSlot[] = [];

  for (const { date, weekday } of eachDate(range)) {
    for (const template of templates) {
      if (template.weekday !== weekday) continue;
      const { startsAt, endsAt } = materializeTemplateSlot(template, date);
      const base = { template, date: dateKey(date), startsAt, endsAt };

      if (existingKeys.has(identityKey(template.id, date))) {
        skipped.push({ ...base, reason: 'already_exists' });
        continue;
      }
      if (ms(startsAt) <= nowMs) {
        skipped.push({ ...base, reason: 'in_past' });
        continue;
      }
      const clashExisting = findCoachConflict(template.coachId, startsAt, endsAt, 'sl_generate_probe' as SlotId);
      const clashPlanned = clashExisting
        ? undefined
        : toCreate.find(
            (p) => p.slot.coachId === template.coachId && overlaps(startsAt, endsAt, p.slot.startsAt, p.slot.endsAt),
          )?.slot;
      const clash = clashExisting ?? clashPlanned;
      if (clash) {
        skipped.push({ ...base, reason: 'coach_conflict', conflictWith: clash.startsAt });
        continue;
      }

      toCreate.push({
        template,
        date: dateKey(date),
        slot: {
          id: newId(ID_PREFIXES.slot) as SlotId,
          coachId: template.coachId,
          startsAt,
          endsAt,
          trainingType: template.trainingType,
          capacity: template.capacity,
          bookedCount: 0,
          gender: template.gender,
          level: template.level,
          status: 'published',
          templateId: template.id,
        },
      });
    }
  }

  return { range, toCreate, skipped };
}

/** Commit a plan's new slots in one additive write. Returns how many were created. */
export function commitGeneration(plan: GenerationPlan): number {
  commitNewSlots(plan.toCreate.map((p) => p.slot));
  return plan.toCreate.length;
}

/**
 * A one-off session (templateId null): not part of any weekly rule, and free to
 * fall outside operating hours. The caller passes concrete UTC instants (computed
 * from Cairo wall time via @tpa/core in the modal). Coach overlap is deliberately
 * NOT blocked here — the modal warns, matching the reschedule seam's "warn, don't
 * block" stance; the DB EXCLUDE constraint is the real guard. S10 → INSERT.
 */
export interface OneOffDraft {
  coachId: CoachId;
  trainingType: TrainingType;
  capacity: number;
  gender: Gender | null;
  level: Level | null;
  startsAt: IsoInstant;
  endsAt: IsoInstant;
}

export type OneOffResult =
  | { ok: true; slot: SessionSlot }
  | {
      ok: false;
      reason: 'end_before_start' | 'in_past' | 'capacity_below_one' | 'group_requires_gender_level';
    };

export function createOneOffSlot(draft: OneOffDraft, now: IsoInstant): OneOffResult {
  if (ms(draft.endsAt) <= ms(draft.startsAt)) return { ok: false, reason: 'end_before_start' };
  if (ms(draft.startsAt) <= ms(now)) return { ok: false, reason: 'in_past' };
  if (draft.capacity < 1) return { ok: false, reason: 'capacity_below_one' };

  const needsGenderLevel = templateRequiresGenderLevel(draft.trainingType);
  if (needsGenderLevel && (draft.gender === null || draft.level === null)) {
    return { ok: false, reason: 'group_requires_gender_level' };
  }

  const slot: SessionSlot = {
    id: newId(ID_PREFIXES.slot) as SlotId,
    coachId: draft.coachId,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    trainingType: draft.trainingType,
    capacity: Math.floor(draft.capacity),
    bookedCount: 0,
    gender: needsGenderLevel ? draft.gender : null,
    level: needsGenderLevel ? draft.level : null,
    status: 'published',
    templateId: null,
  };
  commitNewSlots([slot]);
  return { ok: true, slot };
}
