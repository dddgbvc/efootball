'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

/**
 * Email/password auth.
 *
 * `next` is carried through the whole flow so an invite link survives
 * registration, email verification and login without the player ever losing
 * their place (§23).
 */
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const supabase = createClient();

      if (mode === 'register') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });

        if (signUpError) throw signUpError;

        // Registration is complete the moment the account exists — there is no
        // confirmation step to wait on (migration 1300). GoTrue still withholds
        // the session when its own "Confirm email" setting is on, so sign in
        // directly rather than sending the player to a mailbox.
        if (!data.session) {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (signInError) throw signInError;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      }

      router.push(next);
      router.refresh();
    } catch (err) {
      setError(translate(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      {mode === 'register' ? (
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>الاسم الظاهر</span>
          <input
            className="field"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            minLength={2}
            maxLength={40}
            autoComplete="nickname"
          />
        </label>
      ) : null}

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>البريد الإلكتروني</span>
        <input
          className="field"
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>كلمة المرور</span>
        <input
          className="field"
          type="password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
      </label>

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14, margin: 0 }}>
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? '...' : mode === 'register' ? 'إنشاء الحساب' : 'دخول'}
      </button>

      <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
        {mode === 'register' ? (
          <>
            لديك حساب؟{' '}
            <Link href={`/login?next=${encodeURIComponent(next)}`} style={{ color: 'var(--accent)' }}>
              تسجيل الدخول
            </Link>
          </>
        ) : (
          <>
            ليس لديك حساب؟{' '}
            <Link
              href={`/register?next=${encodeURIComponent(next)}`}
              style={{ color: 'var(--accent)' }}
            >
              إنشاء حساب
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function translate(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'بيانات الدخول غير صحيحة';
  if (/already registered|already exists/i.test(message)) return 'هذا البريد مسجّل بالفعل';
  if (/password/i.test(message) && /least/i.test(message)) return 'كلمة المرور قصيرة جداً';
  if (/email.*confirm/i.test(message)) return 'يرجى تأكيد بريدك الإلكتروني أولاً';
  return message;
}
