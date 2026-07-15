import { Link, Navigate, Route, Routes } from 'react-router-dom';

import { Dashboard } from './pages/Dashboard';
import { PlaceholderPage } from './components/PlaceholderPage';

const ROUTES: { path: string; name: string }[] = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/coaches', name: 'Coaches' },
  { path: '/schedule', name: 'Schedule' },
  { path: '/bookings', name: 'Bookings' },
  { path: '/players', name: 'Players' },
];

export function App() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 200, borderInlineEnd: '1px solid', padding: 16 }}>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {ROUTES.map((route) => (
            <li key={route.path}>
              <Link to={route.path}>{route.name}</Link>
            </li>
          ))}
        </ul>
      </nav>

      <main style={{ flex: 1, padding: 16 }}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          {ROUTES.filter((r) => r.path !== '/dashboard').map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={<PlaceholderPage name={route.name} />}
            />
          ))}
        </Routes>
      </main>
    </div>
  );
}
