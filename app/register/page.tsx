import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';

export const metadata = { title: 'إنشاء حساب' };

export default function RegisterPage() {
  return (
    <div className="shell" style={{ paddingBlock: 64, maxWidth: 440 }}>
      <div className="eyebrow">حساب جديد</div>
      <h1 style={{ fontSize: 30, marginBlock: '10px 24px' }}>انضم إلى المنافسة</h1>
      <Suspense fallback={null}>
        <AuthForm mode="register" />
      </Suspense>
    </div>
  );
}
