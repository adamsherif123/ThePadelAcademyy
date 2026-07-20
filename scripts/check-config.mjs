#!/usr/bin/env node
// Guard against the config.toml auth landmine.
//
// supabase/config.toml legitimately carries, FOR LOCAL DEV ONLY:
//   * [auth.sms.test_otp] fixed-code numbers (phone → code), and
//   * [auth.sms.twilio] enabled=true with PLACEHOLDER credentials.
// If that config is ever pushed to the hosted project (`supabase config push`), those
// numbers become fixed-code login BACKDOORS and the placeholder provider is live.
//
// This script has two jobs:
//   default (in `pnpm verify`): dev-safe hygiene — pass while the dev landmine is the
//     KNOWN placeholder, but FAIL if a REAL secret has leaked into the committed config
//     (a Twilio token/sid that is neither a placeholder nor an env() reference).
//   --prod (the config-push gate): FAIL if ANY test_otp number or placeholder-cred
//     provider is present — i.e. refuse to ship the landmine to production.
//
// The prod gate is wired into `pnpm config:push`, the sanctioned way to push config to a
// non-dev project. See docs/PRODUCTION_CUTOVER.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'supabase', 'config.toml');
const PROD = process.argv.includes('--prod');

const toml = readFileSync(CONFIG, 'utf8');
const lines = toml.split('\n');

/** Collect the raw `key = "value"` entries inside a named [section] (until the next [section]). */
function section(name) {
  const out = {};
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[/.test(line)) inSection = line === `[${name}]`;
    else if (inSection) {
      const m = /^([A-Za-z0-9_]+)\s*=\s*"?([^"#]*)"?/.exec(line);
      if (m) out[m[1].trim()] = m[2].trim();
    }
  }
  return out;
}

const testOtp = section('auth.sms.test_otp');
const twilio = section('auth.sms.twilio');
const testNumbers = Object.keys(testOtp);

// A value is a placeholder if it clearly isn't a real secret: contains "placeholder",
// is empty, or is an env() substitution (the launch-time real-cred mechanism).
const isPlaceholder = (v) => !v || /placeholder/i.test(v) || /^env\(/i.test(v);
// A value looks like a REAL credential: a Twilio SID (AC…/MG…/VA…) or a long secret.
const looksReal = (v) => /^(AC|MG|VA|SK)[A-Za-z0-9]{20,}$/.test(v) || /^[A-Za-z0-9]{28,}$/.test(v);

const problems = [];

if (PROD) {
  // Production gate: the landmine must be entirely absent.
  if (testNumbers.length > 0) {
    problems.push(`[auth.sms.test_otp] has ${testNumbers.length} fixed-code number(s): ${testNumbers.join(', ')}. These are login backdoors — remove the whole section before a production config push.`);
  }
  if (twilio.enabled === 'true' && ['auth_token', 'account_sid', 'message_service_sid'].some((k) => isPlaceholder(twilio[k]))) {
    problems.push(`[auth.sms.twilio] is enabled with placeholder credential(s). Set real creds via env() substitution (see docs/PRODUCTION_CUTOVER.md) before a production config push.`);
  }
} else {
  // Dev-safe hygiene: only fail if a REAL secret has leaked into the committed config.
  for (const k of ['auth_token', 'account_sid', 'message_service_sid']) {
    const v = twilio[k];
    if (v && !isPlaceholder(v) && looksReal(v)) {
      problems.push(`[auth.sms.twilio].${k} looks like a REAL credential committed to config.toml. Move it to an env() substitution and rotate it — never commit a live Twilio secret.`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n✖ config guard FAILED (${PROD ? 'production gate' : 'committed-config hygiene'}):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(
  PROD
    ? '✓ config guard: no test-OTP numbers or placeholder providers — safe to push to production.'
    : '✓ config guard: no real credential leaked into the committed config.toml.',
);
