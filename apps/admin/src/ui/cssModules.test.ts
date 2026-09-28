import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every `styles.X` must name a rule that exists.
 *
 * CSS modules fail silently: `styles.walletGroupHead` for a class nobody wrote
 * is `undefined`, React renders `class={undefined}` — no error, no warning, no
 * type error — and the element simply appears unstyled. That is what happened to
 * the wallet's per-branch heading, which rendered as "Oro Plaza Hotel1 left" at
 * body size with the pin welded to the name, because all three of its classes
 * were missing from the module.
 *
 * Nothing else in the toolchain catches this, so it is caught here.
 *
 * LIMITS, stated so nobody trusts this further than it goes. It only sees
 * literal `styles.name` references, so a computed `styles[variant]` is invisible
 * to it. It asks whether the name is MENTIONED in a selector, so a module with
 * only `.foo > svg` and no `.foo` rule of its own passes. And it says nothing
 * about whether the rule is right or the element looks correct. It catches one
 * thing: a class name that resolves to nothing at all, which is the failure that
 * produces an unstyled element with no error anywhere.
 *
 * It reads the filesystem, so it is typechecked by tsconfig.node.json (which has
 * node types) rather than tsconfig.app.json, which deliberately has none — app
 * code must not reach for node APIs.
 */
const ADMIN_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Class selectors only — `.foo`, `.foo:hover`, `.foo[data-x]`, `.a > .b`. */
function classNamesIn(css: string): Set<string> {
  return new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]!));
}

function styleRefsIn(tsx: string): Set<string> {
  return new Set([...tsx.matchAll(/styles\.([A-Za-z]\w*)/g)].map((m) => m[1]!));
}

describe('CSS modules: every styles.X resolves to a real rule', () => {
  const files = globSync('**/*.tsx', { cwd: ADMIN_SRC }).map((f: string) => join(ADMIN_SRC, f));

  it('finds the admin source to check (guards against an empty pass)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no reference to a class its module never defines', () => {
    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const imported = /import\s+styles\s+from\s+'([^']+\.module\.css)'/.exec(src);
      if (!imported) continue;
      const cssPath = resolve(dirname(file), imported[1]!);
      if (!existsSync(cssPath)) {
        missing.push(`${relative(ADMIN_SRC, file)} imports ${imported[1]} which does not exist`);
        continue;
      }
      const defined = classNamesIn(readFileSync(cssPath, 'utf8'));
      for (const name of [...styleRefsIn(src)].sort()) {
        if (!defined.has(name)) {
          missing.push(`${relative(ADMIN_SRC, file)} uses styles.${name}, absent from ${imported[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
