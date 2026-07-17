import { Navigate, Route, Routes } from 'react-router-dom';

import { Bookings } from './pages/Bookings';
import { Coaches } from './pages/Coaches';
import { Dashboard } from './pages/Dashboard';
import { Gallery } from './pages/Gallery';
import { Login } from './pages/Login';
import { NotAdmin } from './pages/NotAdmin';
import { Packages } from './pages/Packages';
import { Players } from './pages/Players';
import { Schedule } from './pages/Schedule';
import { useSession } from './session/SessionProvider';
import { Shell } from './shell/Shell';

/**
 * Route table + the auth gate over the four auth states (session/authMachine.ts):
 *   loading      — restoring the session / checking is_admin → nothing (brief)
 *   signed_out   — the OTP login
 *   not_admin    — a verified NON-admin: refused clearly, with sign-out (not a trap)
 *   ready        — an admin: the full app
 */
export function App() {
  const { status } = useSession();

  if (status === 'loading') return null;

  if (status === 'signed_out') {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (status === 'not_admin') {
    // A verified user who isn't an admin — a player in the wrong app. Refuse, explain,
    // offer sign-out. Never a dead end (S9.2's lesson).
    return <NotAdmin />;
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/coaches" element={<Coaches />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/players" element={<Players />} />
        <Route path="/packages" element={<Packages />} />
        <Route path="/gallery" element={<Gallery />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
