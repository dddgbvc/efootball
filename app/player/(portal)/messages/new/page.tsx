import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * "Message your opponent" resolved to a conversation.
 *
 * open_direct_room() is the existing RPC: it finds the pair's room or creates
 * it, refuses a block, and refuses a stranger. Nothing here decides who may
 * talk to whom — it only turns a user id into a room id and gets out of the
 * way.
 */
export default async function NewConversationPage(props: {
  searchParams: Promise<{ to?: string }>;
}) {
  const { to } = await props.searchParams;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/player/chat`);
  if (!to) redirect('/player/chat');

  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc('open_direct_room', { p_other_user: to });

  const payload = data as { ok?: boolean; room_id?: string; error?: string } | null;

  if (payload?.ok && payload.room_id) redirect(`/player/messages/${payload.room_id}`);

  const reason =
    payload?.error === 'BLOCKED'
      ? 'لا يمكن فتح محادثة مع هذا اللاعب.'
      : payload?.error === 'USER_NOT_FOUND'
        ? 'هذا اللاعب غير موجود.'
        : 'تعذر فتح المحادثة.';

  return (
    <div className="player-page">
      <div className="panel" style={{ padding: 24, borderColor: 'var(--color-alert-500)' }}>
        <strong style={{ color: 'var(--color-alert-400)' }}>{reason}</strong>
      </div>
      <Link href="/player/chat" className="btn" style={{ marginBlockStart: 16 }}>
        عودة إلى المحادثات
      </Link>
    </div>
  );
}
