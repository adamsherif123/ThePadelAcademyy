import { Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';

import { BrandMark } from '../ui';
import { Sidebar } from './Sidebar';
import styles from './Shell.module.css';

/**
 * The authed app frame: navy sidebar + a scrolling content area for each route.
 *
 * Below the 768px breakpoint the same sidebar becomes an off-canvas drawer, opened
 * from a navy top bar that only exists on mobile. Above it, nothing here renders that
 * didn't render before — the top bar and scrim are `display: none`, so the desktop
 * frame is unchanged.
 */
export function Shell() {
  const [navOpen, setNavOpen] = useState(false);

  // Closing on navigation is handled by the nav links themselves (Sidebar's
  // `onNavigate`), not by watching the pathname: while the drawer is open it covers the
  // screen, so tapping a nav link is the only way to navigate — there's no other route
  // change to react to, and no need for a setState-in-effect to catch one.

  // Escape closes it, same affordance as Modal.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.menuBtn}
          aria-label="Open navigation"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          <Menu size={22} aria-hidden />
        </button>
        <BrandMark />
      </header>

      {navOpen ? (
        <div className={styles.scrim} role="presentation" onClick={() => setNavOpen(false)} />
      ) : null}

      <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />

      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
