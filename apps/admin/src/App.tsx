import { THEME_PACKAGE_NAME } from '@tpa/theme';
import { TYPES_PACKAGE_NAME, type PlaceholderId } from '@tpa/types';
import { Link, Navigate, Route, Routes } from 'react-router-dom';

import { PlaceholderPage } from './components/PlaceholderPage';

const ROUTES: { path: string; name: string }[] = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/coaches', name: 'Coaches' },
  { path: '/schedule', name: 'Schedule' },
  { path: '/bookings', name: 'Bookings' },
  { path: '/players', name: 'Players' },
];

// S0 shared-code proof: rendered in the sidebar footer so cross-package
// resolution is visibly confirmed in the browser, not just at build time.
const proofId: PlaceholderId = 'shared-code-proof';

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
        <footer>
          <small>
            {proofId}: {TYPES_PACKAGE_NAME} + {THEME_PACKAGE_NAME}
          </small>
        </footer>
      </nav>

      <main style={{ flex: 1, padding: 16 }}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          {ROUTES.map((route) => (
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
