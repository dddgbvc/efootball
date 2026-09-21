import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { ChatRoom } from '@/components/ChatRoom';

export const dynamic = 'force-dynamic';

/**
 * One conversation, in the portal shell.
 *
 * There is no membership check in this file, and there should not be: the
 * chat_rooms policy returns nothing for a room the caller does not belong to,
 * so swapping the id in the URL produces the refusal below rather than
 * somebody else's messages.
 */
export default async function PlayerConversationPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/player/messages/${id}`);

  const supabase = await createServerSupabase();

  const { data: room } = await supabase
    .from('chat_rooms')
    .select('id, type, title')
    .eq('id', id)
    .maybeSingle();

  if (!room) {
    return (
      <div className="player-page">
        <div className="panel" style={{ padding: 24, borderColor: 'var(--color-alert-500)' }}>
          <strong style={{ color: 'var(--color-alert-400)' }}>
            ليس لديك صلاحية لعرض هذه المحادثة
          </strong>
        </div>
        <Link href="/player/chat" className="btn" style={{ marginBlockStart: 16 }}>
          عودة إلى المحادثات
        </Link>
      </div>
    );
  }

  const [{ data: messages }, { data: members }] = await Promise.all([
    supabase
      .from('chat_messages')
      .select('id, sender_id, kind, body, system_event, created_at, deleted_at')
      .eq('room_id', id)
      .order('created_at', { ascending: true })
      .limit(200),
    supabase.from('chat_room_members').select('user_id').eq('room_id', id),
  ]);

  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = memberIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', memberIds)
    : { data: [] };

  const title =
    room.type === 'tournament_group'
      ? (room.title ?? 'محادثة البطولة')
      : (profiles?.find((p) => p.id !== user.id)?.display_name ?? 'محادثة');

  return (
    <div className="player-page player-page-flush">
      <div className="player-chat-head">
        <Link href="/player/chat" aria-label="رجوع" className="player-back">
          ›
        </Link>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 17 }}>{title}</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {room.type === 'tournament_group' ? `${memberIds.length} عضو` : 'محادثة خاصة'}
          </div>
        </div>
      </div>

      <ChatRoom
        roomId={id}
        currentUserId={user.id}
        names={Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name]))}
        initial={(messages ?? []).map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          kind: m.kind,
          body: m.deleted_at ? null : m.body,
          systemEvent: m.system_event,
          createdAt: m.created_at,
          deleted: m.deleted_at !== null,
        }))}
      />
    </div>
  );
}
