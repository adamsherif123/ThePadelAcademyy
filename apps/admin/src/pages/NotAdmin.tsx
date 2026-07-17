import { useSession } from '../session/SessionProvider';
import { BrandMark, Button } from '../ui';
import styles from './Login.module.css';

/**
 * Shown to a verified user who is NOT an admin — almost always a player who typed
 * their number into the admin app by mistake. They're not broken; they're just in
 * the wrong place. Say so plainly and offer sign-out — never a dead end (S9.2).
 */
export function NotAdmin() {
  const { player, email, signOut } = useSession();
  const who = player?.name ?? email ?? 'this account';

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <BrandMark size={44} />
        <div className={styles.head}>
          <p className={styles.eyebrow}>Admin</p>
          <h1 className={styles.title}>Not an admin account</h1>
          <p className={styles.subtitle}>
            {`You're signed in as ${who}, which isn't an academy admin. This app is for staff —
            if you're a player, open The Padel Academy app on your phone to book sessions. If you
            think this is a mistake, ask the academy to grant your number admin access.`}
          </p>
        </div>
        <Button className={styles.submit} onClick={() => void signOut()}>
          Sign out / use a different number
        </Button>
      </div>
    </div>
  );
}
