import { redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { ProfileForm } from '@/components/ProfileForm';
import { TelegramLink } from '@/components/TelegramLink';

export const metadata = { title: 'الملف الشخصي' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/dashboard/profile');

  const supabase = await createServerSupabase();
  const [{ data: profile }, { data: telegram }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase
      .from('telegram_connections')
      .select('username, linked_at, revoked_at')
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

  return (
    <div className="shell" style={{ paddingBlock: '40px 80px', maxWidth: 640 }}>
      <div className="eyebrow">الحساب</div>
      <h1 style={{ fontSize: 30, marginBlock: '10px 28px' }}>الملف الشخصي</h1>

      <ProfileForm
        initial={{
          displayName: profile?.display_name ?? '',
          fullName: profile?.full_name ?? '',
          efootballName: profile?.efootball_name ?? '',
          efootballId: profile?.efootball_id ?? '',
          platform: profile?.platform ?? '',
          phone: profile?.phone ?? '',
          telegramUsername: profile?.telegram_username ?? '',
          bio: profile?.bio ?? '',
          avatarPath: profile?.avatar_path ?? null,
        }}
        userId={user.id}
      />

      <section className="strip" style={{ marginBlockStart: 38 }}>
        <h2 style={{ fontSize: 19, marginBlockEnd: 12 }}>Telegram</h2>
        <TelegramLink
          linked={Boolean(telegram?.linked_at && !telegram.revoked_at)}
          username={telegram?.username ?? null}
        />
      </section>
    </div>
  );
}
