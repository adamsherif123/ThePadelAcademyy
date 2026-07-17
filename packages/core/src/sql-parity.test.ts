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
