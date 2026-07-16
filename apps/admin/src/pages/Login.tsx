import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSession } from '../session/SessionProvider';
import { BrandMark, Button, Input } from '../ui';
import styles from './Login.module.css';

/**
 * Admin login — not designed by v0, built to the brand language (navy, minimal).
 * A mock gate: any non-empty email + password signs in. S8 swaps the signIn body
 * for real admin auth; this screen is unchanged.
 */
export function Login() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('rania@thepadelacademy.eg');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!signIn(email, password)) {
      setError('Enter your email and password to continue.');
      return;
    }
    navigate('/dashboard', { replace: true });
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
        <Button type="submit" className={styles.submit}>
          Sign in
        </Button>
        <p className={styles.note}>Mock gate — any email + password signs you in.</p>
      </form>
    </div>
  );
}
