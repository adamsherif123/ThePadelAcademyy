import { Outlet } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import styles from './Shell.module.css';

/** The authed app frame: navy sidebar + a scrolling content area for each route. */
export function Shell() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
