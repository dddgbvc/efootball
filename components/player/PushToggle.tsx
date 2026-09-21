'use client';

import { useEffect, useState } from 'react';

type State = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on' | 'working';

/**
 * Turns push on or off for this device.
 *
 * It asks for permission only when the player presses the button. A page that
 * demands notification permission on load gets denied once and then can never
 * ask again — the permission is not recoverable from inside the page.
 */
export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<State>('working');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Resolved in a callback rather than in the effect body: the checks below
    // are cheap but one of them is genuinely async, and splitting them would
    // mean rendering twice on every mount.
    void (async () => {
      const next = await resolveState(vapidPublicKey);
      if (!cancelled) setState(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    if (!vapidPublicKey) return;
    setError(null);
    setState('working');

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(vapidPublicKey),
      });

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };

      if (!payload.ok) {
        await subscription.unsubscribe();
        setError(payload.message ?? 'تعذر تفعيل التنبيهات');
        setState('off');
        return;
      }

      setState('on');
    } catch {
      setError('تعذر تفعيل التنبيهات على هذا الجهاز.');
      setState('off');
    }
  }

  async function disable() {
    setError(null);
    setState('working');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState('off');
    } catch {
      setError('تعذر إيقاف التنبيهات.');
      setState('on');
    }
  }

  const message: Record<State, string> = {
    unsupported: 'هذا المتصفح لا يدعم تنبيهات الويب.',
    unconfigured: 'التنبيهات غير مفعّلة على هذا الخادم بعد.',
    denied: 'التنبيهات محظورة في إعدادات المتصفح. فعّلها من إعدادات الموقع.',
    off: 'تصلك تنبيهات عند فتح جولة جديدة أو اعتماد نتيجة أو وصول رسالة.',
    on: 'التنبيهات مفعّلة على هذا الجهاز.',
    working: '...',
  };

  return (
    <section className="panel" style={{ padding: 18 }}>
      <div className="eyebrow">تنبيهات الجهاز</div>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '8px 0 12px' }}>
        {message[state]}
      </p>

      {state === 'off' ? (
        <button type="button" className="btn btn-primary" onClick={enable}>
          تفعيل التنبيهات
        </button>
      ) : null}
      {state === 'on' ? (
        <button type="button" className="btn" onClick={disable}>
          إيقاف التنبيهات
        </button>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 13, marginBlockStart: 10 }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

async function resolveState(vapidPublicKey: string | null): Promise<State> {
  if (!vapidPublicKey) return 'unconfigured';
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/**
 * VAPID keys travel as base64url; PushManager wants the raw bytes, backed by a
 * plain ArrayBuffer rather than whatever a Uint8Array happens to be sitting on.
 */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalised);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}
