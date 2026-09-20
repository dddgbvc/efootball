import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';

export const metadata = { title: 'تسجيل الدخول' };

export default function LoginPage() {
  return (
    <div className="shell" style={{ paddingBlock: 64, maxWidth: 440 }}>
      <div className="eyebrow">الدخول</div>
      <h1 style={{ fontSize: 30, marginBlock: '10px 24px' }}>أهلاً بعودتك</h1>
      <Suspense fallback={null}>
        <AuthForm mode="login" />
      </Suspense>
    </div>
  );
}
