import { useState, type FormEvent } from 'react';

import { useSession } from '../session/SessionProvider';
import { BrandMark, Button, Input } from '../ui';
import styles from './Login.module.css';

/**
 * Admin login — real phone OTP (S10b), mirroring the client. Two steps: send a code
 * to the phone, then verify it. On success the App re-renders on the auth-state flip
 * (to the app if this number is an admin, or to the refusal screen if it isn't), so
 * this screen doesn't navigate.
 */
export function Login() {
  const { sendOtp, verifyOtp } = useSession();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onSendCode = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await sendOtp(phone.trim());
    setBusy(false);
    if (res.ok) setStep('code');
    else setError(res.error ?? 'Could not send the code. Please try again.');
  };

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await verifyOtp(code.trim());
    if (!res.ok) {
      setBusy(false);
      setError(res.error ?? 'That code didn’t work. Check it and try again.');
      setCode('');
    }
    // On success: the auth state flips and App re-renders; nothing to navigate.
  };

  return (
    <div className={styles.screen}>
      {step === 'phone' ? (
        <form className={styles.panel} onSubmit={onSendCode}>
          <BrandMark size={44} />
          <div className={styles.head}>
            <p className={styles.eyebrow}>Admin</p>
            <h1 className={styles.title}>Sign in</h1>
            <p className={styles.subtitle}>
              Manage the academy — schedule, coaches, bookings and players. We&apos;ll text a code
              to your admin number.
            </p>
          </div>
          <Input
            type="tel"
            inputMode="tel"
            placeholder="Phone — e.g. 1XX XXX XXXX"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <Button type="submit" className={styles.submit} disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </Button>
        </form>
      ) : (
        <form className={styles.panel} onSubmit={onVerify}>
          <BrandMark size={44} />
          <div className={styles.head}>
            <p className={styles.eyebrow}>Verification</p>
            <h1 className={styles.title}>Enter the code</h1>
            <p className={styles.subtitle}>We sent a 6-digit code to {phone}.</p>
          </div>
          <Input
            type="text"
            inputMode="numeric"
            placeholder="6-digit code"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
            autoFocus
          />
          {error ? <p className={styles.error}>{error}</p> : null}
          <Button type="submit" className={styles.submit} disabled={busy}>
            {busy ? 'Verifying…' : 'Verify'}
          </Button>
          <button
            type="button"
            className={styles.note}
            onClick={() => {
              setStep('phone');
              setError('');
              setCode('');
            }}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ← Use a different number
          </button>
        </form>
      )}
    </div>
  );
}
