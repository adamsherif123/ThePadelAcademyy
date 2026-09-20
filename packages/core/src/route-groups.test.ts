import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Route-group names must be unique across the WHOLE mobile app tree.
 *
 * The guard for a bug that shipped: making the coach tab bar a nested group called
 * `(tabs)` put a second group of that name in the tree beside the player's
 * `app/(tabs)`. That made the plain path `/(tabs)` ambiguous, and the redirect that
 * sends a NON-coach out of the coach group resolved straight back into it. An
 * unlinked account was stranded on a screen whose query was gated off, so it showed
 * a spinner that could never finish, with no error anywhere.
 *
 * `nextRoute` hands the router bare strings (`/(tabs)`, `/(coach)/(shell)`), which
 * only works while each group name identifies exactly one place. Nothing in the type
 * system enforces that, and the auth-machine tests cannot see it — they assert the
 * STRING, and the string was right. Only the filesystem was wrong.
 *
 * Lives here rather than in apps/mobile for the same reason sql-parity does: it
 * reads the repo off disk, and this package's tsconfig excludes tests, so node:fs
 * needs no type plumbing in an app that has none.
 */
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'mobile', 'src', 'app');

function groupDirs(dir: string, rel = '', found: { name: string; at: string }[] = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const here = rel ? `${rel}/${entry}` : entry;
    if (entry.startsWith('(') && entry.endsWith(')')) found.push({ name: entry, at: here });
    groupDirs(full, here, found);
  }
  return found;
}

describe('expo-router route groups', () => {
  it('never reuses a group name anywhere in the tree', () => {
    const byName = new Map<string, string[]>();
    for (const g of groupDirs(APP_DIR)) byName.set(g.name, [...(byName.get(g.name) ?? []), g.at]);
    const duplicated = [...byName.entries()].filter(([, at]) => at.length > 1);

    expect(
      duplicated,
      'Duplicate route-group name(s). A bare "/(name)" path is ambiguous when two groups ' +
        `share it, which silently breaks router.replace: ${JSON.stringify(duplicated)}`,
    ).toEqual([]);
  });

  it('is not vacuous — it finds the groups it is meant to be checking', () => {
    const names = groupDirs(APP_DIR).map((g) => g.name);
    expect(names).toContain('(tabs)');
    expect(names).toContain('(auth)');
    expect(names).toContain('(coach)');
    expect(names).toContain('(shell)');
  });
});
