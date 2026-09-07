import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Medal,
  Newspaper,
  Package,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';

import { useCreditRequests } from '../data/queries';
import { queryClient, queryKeys } from '../lib/queryClient';
import { supabase } from '../lib/supabase';
import { useSession } from '../session/SessionProvider';
import { Avatar, BrandMark } from '../ui';
import styles from './Sidebar.module.css';

/** Nav items in the v0 order (Dashboard first, Packages last). */
const NAV: readonly { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/schedule', label: 'Schedule', icon: CalendarDays },
  { to: '/coaches', label: 'Coaches', icon: Medal },
  { to: '/bookings', label: 'Bookings', icon: ClipboardList },
  { to: '/players', label: 'Players', icon: Users },
  { to: '/credit-requests', label: 'Credit requests', icon: Wallet },
  { to: '/packages', label: 'Packages', icon: Package },
  { to: '/news', label: 'News', icon: Newspaper },
];

/**
 * The navy full-height sidebar: brand, nav (royal pill for the active item), user card.
 *
 * Below the shell's 768px breakpoint the very same element is an off-canvas drawer:
 * `open` slides it in, and `onNavigate` lets the Shell close it when a link is tapped.
 * Both props are inert above the breakpoint, where the sidebar is always in flow — so
 * the desktop sidebar is untouched.
 */
export function Sidebar({ open = false, onNavigate }: { open?: boolean; onNavigate?: () => void } = {}) {
  const { admin, signOut } = useSession();
  const creditRequestsQ = useCreditRequests();
  const pendingCount = (creditRequestsQ.data ?? []).filter((r) => r.status === 'pending').length;

  // Live: any insert/update on credit_requests (a player submits one, or another admin
  // resolves one) refreshes the query cache with no manual reload. Mounted once here,
  // since Sidebar is always on-screen for a signed-in admin (Shell only renders once
  // `status === 'ready'`) — same one-subscription-for-the-whole-app shape as the mobile
  // client's NotificationsBridge.
  //
  // THREE keys, not one: this badge reads the whole-table `creditRequests`, but the
  // Credit Requests page now has its own paginated read and its own whole-table counts.
  // Invalidating only the first would light up the badge while the page the admin is
  // staring at kept showing a stale list.
  useEffect(() => {
    const channel = supabase
      .channel('admin:credit_requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_requests' }, () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.creditRequests });
        void queryClient.invalidateQueries({ queryKey: queryKeys.creditRequestsPage });
        void queryClient.invalidateQueries({ queryKey: queryKeys.creditRequestStatusCounts });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <aside className={styles.sidebar} data-open={open ? 'true' : 'false'}>
      <div className={styles.brand}>
        <BrandMark />
      </div>

      <nav className={styles.nav}>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => [styles.item, isActive ? styles.active : ''].join(' ').trim()}
            onClick={onNavigate}
          >
            <Icon size={20} aria-hidden />
            {label}
            {to === '/credit-requests' && pendingCount > 0 ? (
              <span className={styles.navBadge} aria-label={`${pendingCount} pending credit requests`}>
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      {admin ? (
        <div className={styles.user}>
          <Avatar name={admin.name} size={40} />
          <div className={styles.userInfo}>
            <span className={styles.userName}>{admin.name}</span>
            <span className={styles.userRole}>{admin.role}</span>
          </div>
          <button
            type="button"
            className={styles.signout}
            aria-label="Sign out"
            onClick={() => void signOut()}
          >
            <LogOut size={18} aria-hidden />
          </button>
        </div>
      ) : null}

      {/* A plain <a>, not react-router's <Link>: /privacy.html is a static file
          (apps/admin/public/), not a defined Route — Link would be caught by App.tsx's
          client-side wildcard and redirected to /dashboard instead of ever reaching it. */}
      <a href="/privacy.html" target="_blank" rel="noreferrer" className={styles.footerLink}>
        Privacy Policy
      </a>
    </aside>
  );
}
