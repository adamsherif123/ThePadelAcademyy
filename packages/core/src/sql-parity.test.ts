import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CANCELLATION_WINDOW_HOURS, CREDIT_EXPIRY_DAYS } from './constants';

/**
 * The anti-drift guard for the constants that live in BOTH @tpa/core and the SQL
 * migrations (CANCELLATION_WINDOW_HOURS, CREDIT_EXPIRY_DAYS). No codegen — instead
 * this one test reads BOTH sides: the core constant here, and the `interval '…'`
 * literal out of the `tpa.*()` functions in the migrations. If someone changes one
 * side and forgets the other, this fails in the normal app test run. See the S7a
 * report for why codegen isn't worth it for two constants.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

const allMigrationSql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'))
  .join('\n');

/** The interval literal a `create ... function tpa.<name>()` returns, e.g. "3 hours". */
function tpaInterval(fnName: string): string | null {
  const re = new RegExp(`function\\s+tpa\\.${fnName}\\s*\\([\\s\\S]*?interval\\s+'([^']+)'`, 'i');
  return allMigrationSql.match(re)?.[1] ?? null;
}

describe('SQL ⇄ core constant parity (no silent drift)', () => {
  it('tpa.cancellation_window() mirrors CANCELLATION_WINDOW_HOURS', () => {
    expect(tpaInterval('cancellation_window')).toBe(`${CANCELLATION_WINDOW_HOURS} hours`);
  });

  it('tpa.credit_expiry() mirrors CREDIT_EXPIRY_DAYS', () => {
    expect(tpaInterval('credit_expiry')).toBe(`${CREDIT_EXPIRY_DAYS} days`);
  });
});

/**
 * The expiry-discipline guard (S7b Task 8). tpa.credit_expiry() / tpa.cancellation_window()
 * exist so no RPC inlines `interval '30 days'` / `interval '3 hours'`. All three
 * mint paths (settle_purchase, record_cash_purchase, grant_credits) must call
 * tpa.credit_expiry() instead. This fails if either literal appears MORE THAN ONCE
 * across the migrations — i.e. anywhere but its one defining function.
 *
 * Comments are stripped first (a comment may legitimately mention the literal, as
 * the S7a migration's own "do not inline" note does). LIMITS: it matches the exact
 * literal only — a paraphrase like `interval '30 day'` (singular), `interval '720
 * hours'`, or `now() + 2592000 * interval '1 second'` would evade it. It catches
 * the realistic copy-paste inlining, not a determined workaround.
 */
const strippedSql = allMigrationSql.replace(/--.*$/gm, '');
const occurrences = (needle: string): number => strippedSql.split(needle).length - 1;

describe('expiry/window literals live ONLY in their tpa.* function (no inlining)', () => {
  it(`interval '${CREDIT_EXPIRY_DAYS} days' appears exactly once (tpa.credit_expiry)`, () => {
    expect(occurrences(`interval '${CREDIT_EXPIRY_DAYS} days'`)).toBe(1);
  });

  it(`interval '${CANCELLATION_WINDOW_HOURS} hours' appears exactly once (tpa.cancellation_window)`, () => {
    expect(occurrences(`interval '${CANCELLATION_WINDOW_HOURS} hours'`)).toBe(1);
  });
});
