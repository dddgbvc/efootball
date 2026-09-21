import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { JoinPrompt } from '@/components/player/JoinPrompt';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'الانضمام إلى بطولة' };

export default async function PlayerJoinPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/player/join');

  return (
    <div className="player-page">
      <h1 style={{ fontSize: 24, marginBlockEnd: 6 }}>الانضمام إلى بطولة</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 18px' }}>
        اطلب كود البطولة من منظّمها، ثم أدخله هنا ليصله طلبك.
      </p>

      <JoinPrompt />

      <Link href="/player" className="btn" style={{ width: '100%', marginBlockStart: 12 }}>
        عودة
      </Link>
    </div>
  );
}
