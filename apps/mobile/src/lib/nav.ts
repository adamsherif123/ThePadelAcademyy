import { router, type Href } from 'expo-router';

/**
 * Terminal-screen navigation. A success / submitted / already-done screen sits at the END
 * of a deep push flow (e.g. wallet → buy-credits → package → request-credits). The flow is
 * over, so navigating on with push/replace leaves that DEAD flow below the destination —
 * escaping it then takes several back-taps (or a swipe-back re-enters a completed flow).
 * These reset the stack instead: router.replace only swaps the top screen, so it can't fix
 * this on its own.
 */

/**
 * Pop the whole flow and land on a TAB. `dismissTo` popToo's the root stack back to the
 * (tabs) route (always present at the bottom) and the href selects the tab — a clean stack
 * with nothing stale beneath, so a swipe-back can't return into the finished flow.
 */
export function resetToTab(href: Href): void {
  router.dismissTo(href);
}

/**
 * Pop the whole flow to the tabs root, then open `href` on top — so its back path is a
 * single tap to the tabs, not a walk back through the dead flow.
 */
export function resetTo(href: Href): void {
  router.dismissAll();
  router.push(href);
}
