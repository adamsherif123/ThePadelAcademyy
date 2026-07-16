import { Navigate, Route, Routes } from 'react-router-dom';

import { Bookings } from './pages/Bookings';
import { Coaches } from './pages/Coaches';
import { Dashboard } from './pages/Dashboard';
import { Gallery } from './pages/Gallery';
import { Login } from './pages/Login';
import { Packages } from './pages/Packages';
import { Players } from './pages/Players';
import { Schedule } from './pages/Schedule';
import { useSession } from './session/SessionProvider';
import { Shell } from './shell/Shell';

/**
 * Route table + the auth gate. Signed-out admins only reach /login; everything
 * else redirects there. Once signed in, the Shell frames every route and unknown
 * paths fall to the dashboard. Sign-out flips `isAuthed`, which drops back to the
 * login routes. S8 swaps the session's internals; this gate is unchanged.
 */
export function App() {
  const { isAuthed } = useSession();

  if (!isAuthed) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
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
