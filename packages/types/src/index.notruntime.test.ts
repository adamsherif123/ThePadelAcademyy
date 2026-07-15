import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * @tpa/types must emit ZERO runtime JavaScript — a Deno Edge Function imports it
 * with no build step, and any `enum`/`const`/runtime statement would break that
 * contract. This guard compiles the package to JS and asserts every emitted file
 * reduces to nothing once comments and the trivial `export {};` marker are removed.
 *
 * Add `export const FOO = 1` to any src file and this test goes red.
 */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const emitDir = join(pkgRoot, '.emitcheck');

/** Strip comments, `"use strict";`, the empty-module `export {};`, and whitespace. */
function residueAfterStrippingBoilerplate(js: string): string {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/[^\n]*/g, '') // line comments
    .replace(/["']use strict["'];?/g, '')
    .replace(/export\s*\{\s*\}\s*;?/g, '') // TS marker for an emitted-but-empty ES module
    .replace(/\s/g, '');
}

function walkJsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walkJsFiles(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

describe('@tpa/types emits no runtime JavaScript', () => {
  it('compiles every source file to an empty ES module', () => {
    rmSync(emitDir, { recursive: true, force: true });
    // Real tsc emit (not esbuild) so the check reflects the actual build output.
    execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.emitcheck.json'], {
      cwd: pkgRoot,
      stdio: 'pipe',
    });

    const jsFiles = walkJsFiles(emitDir);
    expect(jsFiles.length).toBeGreaterThan(0); // sanity: something was emitted

    const offenders = jsFiles
      .map((file) => ({ file, residue: residueAfterStrippingBoilerplate(readFileSync(file, 'utf8')) }))
      .filter(({ residue }) => residue.length > 0);

    rmSync(emitDir, { recursive: true, force: true });

    expect(
      offenders,
      `These files emitted runtime code:\n${offenders.map((o) => `  ${o.file}: ${o.residue}`).join('\n')}`,
    ).toEqual([]);
  });
});
