import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { ChatRoom } from '@/components/ChatRoom';

export const dynamic = 'force-dynamic';

export default async function ConversationPage(props: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await props.params;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/messages/${conversationId}`);

  const supabase = await createServerSupabase();

  /*
   * No explicit membership check is needed here beyond this read: the RLS
   * policy on chat_rooms only returns rooms the caller belongs to, so guessing
   * a conversation id yields nothing. Swapping the id in the URL is exactly the
   * case §55 requires to fail.
   */
  const { data: room } = await supabase
    .from('chat_rooms')
    .select('id, type, title, tournament_id')
    .eq('id', conversationId)
    .maybeSingle();

  if (!room) notFound();

  const [{ data: messages }, { data: members }] = await Promise.all([
    supabase
      .from('chat_messages')
      .select('id, sender_id, kind, body, system_event, created_at, deleted_at, reply_to_id')
      .eq('room_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200),
    supabase.from('chat_room_members').select('user_id, role').eq('room_id', conversationId),
  ]);

  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = memberIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', memberIds)
    : { data: [] };

  const title =
    room.type === 'tournament_group'
      ? (room.title ?? 'مجموعة البطولة')
      : (profiles?.find((p) => p.id !== user.id)?.display_name ?? 'محادثة');

  return (
    <div className="shell" style={{ paddingBlock: '20px 0', maxWidth: 760 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingBlockEnd: 12,
          borderBottom: '1px solid var(--line)',
        }}
      >
        <Link href="/messages" aria-label="رجوع" style={{ fontSize: 20 }}>
          ›
        </Link>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 18 }}>{title}</h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {room.type === 'tournament_group'
              ? `${memberIds.length} عضو`
              : 'محادثة خاصة'}
          </div>
        </div>
      </div>

      <ChatRoom
        roomId={conversationId}
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
