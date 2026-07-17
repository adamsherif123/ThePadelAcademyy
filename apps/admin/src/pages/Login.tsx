import { useState, type FormEvent } from 'react';

import { useSession } from '../session/SessionProvider';
import { BrandMark, Button, Input } from '../ui';
import styles from './Login.module.css';

/**
 * Admin login — email + password (S10b.1). On success the App re-renders on the
 * auth-state flip (to the app if this account is an admin, or to the refusal screen
 * if it isn't), so this screen doesn't navigate. No password reset in-app — a single
 * admin resets it from the Supabase dashboard.
 */
export function Login() {
  const { signInWithEmail } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await signInWithEmail(email, password);
    if (!res.ok) {
      setBusy(false);
      setError(res.error ?? 'Could not sign in. Check your email and password.');
    }
    // On success: the auth state flips and App re-renders; nothing to navigate.
  };

  return (
    <div className={styles.screen}>
      <form className={styles.panel} onSubmit={onSubmit}>
        <BrandMark size={44} />
        <div className={styles.head}>
          <p className={styles.eyebrow}>Admin</p>
          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.subtitle}>
            Manage the academy — schedule, coaches, bookings and players.
          </p>
        </div>
        <Input
          type="email"
          placeholder="Email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className={styles.error}>{error}</p> : null}
        <Button type="submit" className={styles.submit} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
