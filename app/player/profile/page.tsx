import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { AvatarUploader } from '@/components/player/AvatarUploader';
import { avatarPublicUrl } from '@/lib/player/avatar';
import { PushToggle } from '@/components/player/PushToggle';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'حسابي' };

/**
 * Outside the rules gate on purpose: a player who has not accepted the rules
 * still needs to reach their own account, and §60 says so explicitly.
 */
export default async function PlayerProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/player/profile');

  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, efootball_name, efootball_id, platform, avatar_path, telegram_username')
    .eq('id', user.id)
    .maybeSingle();

  return (
    <div className="player-page">
      <h1 style={{ fontSize: 24, marginBlockEnd: 18 }}>الملف الشخصي</h1>

      <AvatarUploader
        initialPath={profile?.avatar_path ?? null}
        initialUrl={avatarPublicUrl(profile?.avatar_path ?? null)}
        name={profile?.display_name ?? 'لاعب'}
      />

      <section className="panel" style={{ padding: 18, marginBlockStart: 16 }}>
        <div className="eyebrow" style={{ marginBlockEnd: 12 }}>
          بياناتك
        </div>
        <dl className="player-facts">
          <dt>الاسم الظاهر</dt>
          <dd>{profile?.display_name ?? '—'}</dd>
          <dt>الاسم داخل اللعبة</dt>
          <dd dir="ltr">{profile?.efootball_name ?? '—'}</dd>
          <dt>معرّف eFootball</dt>
          <dd dir="ltr">{profile?.efootball_id ?? '—'}</dd>
          <dt>المنصة</dt>
          <dd dir="ltr">{profile?.platform ?? '—'}</dd>
        </dl>
        <Link href="/dashboard/profile" className="btn" style={{ marginBlockStart: 14 }}>
          تعديل بياناتي
        </Link>
      </section>

      <div style={{ marginBlockStart: 16 }}>
        <PushToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} />
      </div>

      <Link href="/player/rules" className="btn" style={{ marginBlockStart: 12, width: '100%' }}>
        قوانين البطولة
      </Link>
    </div>
  );
}
