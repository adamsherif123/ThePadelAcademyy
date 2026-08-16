import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BOOKING_WINDOW_HOURS,
  CANCELLATION_WINDOW_HOURS,
  CANONICAL_CAPACITY,
  CREDIT_EXPIRY_DAYS,
  SIGNUP_TRIAL_CREDITS,
} from './constants';

/**
 * The anti-drift guard for the constants that live in BOTH @tpa/core and the SQL
 * migrations (CANCELLATION_WINDOW_HOURS, CREDIT_EXPIRY_DAYS). No codegen — instead
 * this one test reads BOTH sides: the core constant here, and the `interval '…'`
 * literal out of the `tpa.*()` functions in the migrations. If someone changes one
 * side and forgets the other, this fails in the normal app test run. See the S7a
 * report for why codegen isn't worth it for two constants.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

// Sorted so concatenation order matches actual migration-application order
// (filenames are date-prefixed) — load-bearing for the "last match wins" helpers
// below, since a `create or replace function tpa.*()` in a later migration must
// be found AFTER (and so override) its original definition in an earlier one.
const allMigrationSql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'))
  .join('\n');

/**
 * The interval literal a `create ... function tpa.<name>()` returns, e.g. "3
 * hours" — the LAST match across all migrations, since `create or replace`
 * (e.g. credit_expiry's 30->40 redefinition) means the live definition is
 * whichever migration ran most recently, not the first one textually.
 */
function tpaInterval(fnName: string): string | null {
  const re = new RegExp(`function\\s+tpa\\.${fnName}\\s*\\([\\s\\S]*?interval\\s+'([^']+)'`, 'gi');
  const matches = [...allMigrationSql.matchAll(re)];
  return matches.at(-1)?.[1] ?? null;
}

/** The integer a `create ... function tpa.<name>()` returns via `select <N>` — last match wins (see tpaInterval). */
function tpaInt(fnName: string): string | null {
  const re = new RegExp(`function\\s+tpa\\.${fnName}\\s*\\(\\s*\\)[\\s\\S]*?select\\s+(\\d+)`, 'gi');
  const matches = [...allMigrationSql.matchAll(re)];
  return matches.at(-1)?.[1] ?? null;
}

/** The `when 'x' then N` branches of a single-arg `tpa.<name>(text)` CASE function — last definition wins (see tpaInterval). */
function tpaCaseMap(fnName: string): Record<string, number> {
  const fnRe = new RegExp(`function\\s+tpa\\.${fnName}\\s*\\([^)]*\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, 'gi');
  const matches = [...allMigrationSql.matchAll(fnRe)];
  const body = matches.at(-1)?.[1] ?? '';
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/when\s+'(\w+)'\s+then\s+(\d+)/gi)) out[m[1]!] = Number(m[2]);
  return out;
}

describe('SQL ⇄ core constant parity (no silent drift)', () => {
  it('tpa.cancellation_window() mirrors CANCELLATION_WINDOW_HOURS', () => {
    expect(tpaInterval('cancellation_window')).toBe(`${CANCELLATION_WINDOW_HOURS} hours`);
  });

  it('tpa.booking_window() mirrors BOOKING_WINDOW_HOURS', () => {
    expect(tpaInterval('booking_window')).toBe(`${BOOKING_WINDOW_HOURS} hours`);
  });

  it('tpa.credit_expiry() mirrors CREDIT_EXPIRY_DAYS', () => {
    expect(tpaInterval('credit_expiry')).toBe(`${CREDIT_EXPIRY_DAYS} days`);
  });

  it('tpa.signup_trial_credits() mirrors SIGNUP_TRIAL_CREDITS', () => {
    expect(tpaInt('signup_trial_credits')).toBe(String(SIGNUP_TRIAL_CREDITS));
  });

  it('tpa.canonical_capacity(text) mirrors CANONICAL_CAPACITY for every training type', () => {
    expect(tpaCaseMap('canonical_capacity')).toEqual(CANONICAL_CAPACITY);
  });
});

/**
 * The expiry-discipline guard (S7b Task 8). tpa.credit_expiry() / tpa.cancellation_window()
 * / tpa.booking_window() exist so no RPC inlines `interval '40 days'` / `interval
 * '5 hours'` directly. All the mint/guard paths must call the tpa.* helper instead.
 *
 * Comments are stripped first (a comment may legitimately mention the literal, as
 * the S7a migration's own "do not inline" note does). LIMITS: it matches the exact
 * literal only — a paraphrase like `interval '30 day'` (singular), `interval '720
 * hours'`, or `now() + 2592000 * interval '1 second'` would evade it. It catches
 * the realistic copy-paste inlining, not a determined workaround.
 */
const strippedSql = allMigrationSql.replace(/--.*$/gm, '');
const occurrences = (needle: string): number => strippedSql.split(needle).length - 1;

/**
 * How many of `literal`'s occurrences are immediately part of a `function
 * tpa.<name>(...)` definition — ANY tpa.* function, not one specific name. Used
 * below instead of a flat "appears exactly once" check: CANCELLATION_WINDOW_HOURS
 * and BOOKING_WINDOW_HOURS are two independently-named constants that happen to
 * both be 5 today (see constants.ts), so `interval '5 hours'` legitimately appears
 * twice — once per function's own definition. If this count falls short of
 * occurrences(literal), something inlined the literal directly in an RPC body
 * instead of calling the helper.
 */
function tpaDefinedOccurrences(literal: string): number {
  const re = new RegExp(`function\\s+tpa\\.\\w+\\s*\\([^)]*\\)[\\s\\S]*?interval\\s+'${literal}'`, 'gi');
  return [...strippedSql.matchAll(re)].length;
}

describe('expiry/window literals live ONLY in tpa.* function definitions (no inlining)', () => {
  it(`interval '${CREDIT_EXPIRY_DAYS} days' only appears inside a tpa.* definition (tpa.credit_expiry)`, () => {
    const literal = `${CREDIT_EXPIRY_DAYS} days`;
    expect(occurrences(`interval '${literal}'`)).toBe(tpaDefinedOccurrences(literal));
  });

  it(`interval '${CANCELLATION_WINDOW_HOURS} hours' only appears inside tpa.* definitions (tpa.cancellation_window, tpa.booking_window)`, () => {
    const literal = `${CANCELLATION_WINDOW_HOURS} hours`;
    expect(occurrences(`interval '${literal}'`)).toBe(tpaDefinedOccurrences(literal));
  });
});
