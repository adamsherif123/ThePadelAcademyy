import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Medal,
  Package,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

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
];

/** The navy full-height sidebar: brand, nav (royal pill for the active item), user card. */
export function Sidebar() {
  const { admin, signOut } = useSession();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <BrandMark />
      </div>

      <nav className={styles.nav}>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => [styles.item, isActive ? styles.active : ''].join(' ').trim()}
          >
            <Icon size={20} aria-hidden />
            {label}
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
    </aside>
  );
}
