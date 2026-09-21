import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadPlayerContext } from '@/lib/player/context';
import { Avatar } from '@/components/player/Avatar';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'المحادثات' };

/**
 * The portal's view of conversations.
 *
 * The rooms, the messages and the membership rules are the ones the rest of
 * the app already uses — this page is a different presentation of the same
 * data, not a second chat system. Every read below is bounded by the
 * chat_rooms policy, so an unrelated conversation simply is not in the result.
 */
export default async function PlayerChatPage() {
  const result = await loadPlayerContext();
  if (!result.ok) redirect('/player');

  const { context } = result;
  const supabase = await createServerSupabase();

  const { data: memberships } = await supabase
    .from('chat_room_members')
    .select('room_id')
    .eq('user_id', context.userId);

  const roomIds = (memberships ?? []).map((m) => m.room_id);

  if (roomIds.length === 0) {
    return (
      <div className="player-page">
        <h1 style={{ fontSize: 24, marginBlockEnd: 16 }}>المحادثات</h1>
        <div className="panel player-empty">لا توجد محادثات بعد.</div>
      </div>
    );
  }

  const [{ data: rooms }, { data: recent }, { data: others }] = await Promise.all([
    supabase.from('chat_rooms').select('id, type, title, tournament_id').in('id', roomIds),
    supabase
      .from('chat_messages')
      .select('id, room_id, body, kind, created_at, sender_id, deleted_at')
      .in('room_id', roomIds)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('chat_room_members')
      .select('room_id, user_id')
      .in('room_id', roomIds)
      .neq('user_id', context.userId),
  ]);

  const otherIds = [...new Set((others ?? []).map((m) => m.user_id))];
  const { data: profiles } = otherIds.length
    ? await supabase.from('profiles').select('id, display_name, avatar_path').in('id', otherIds)
    : { data: [] };

  const lastOf = (roomId: string) => recent?.find((m) => m.room_id === roomId);

  const sorted = [...(rooms ?? [])].sort((a, b) => {
    const at = lastOf(a.id)?.created_at ?? '';
    const bt = lastOf(b.id)?.created_at ?? '';
    return bt.localeCompare(at);
  });

  return (
    <div className="player-page">
      <h1 style={{ fontSize: 24, marginBlockEnd: 16 }}>المحادثات</h1>
      <ul className="player-list">
        {sorted.map((room) => {
          const last = lastOf(room.id);
          const partnerId = others?.find((m) => m.room_id === room.id)?.user_id;
          const partner = profiles?.find((p) => p.id === partnerId);
          const isGroup = room.type === 'tournament_group';
          const title = isGroup
            ? (room.title ?? 'محادثة البطولة')
            : (partner?.display_name ?? 'محادثة خاصة');

          return (
            <li key={room.id}>
              <Link
                href={`/player/messages/${room.id}`}
                className="panel card-link player-row"
                style={{ alignItems: 'center', gap: 12 }}
              >
                <Avatar
                  path={isGroup ? null : (partner?.avatar_path ?? null)}
                  name={title}
                  size={40}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{title}</div>
                  <div className="player-row-body">
                    {last
                      ? last.deleted_at
                        ? 'رسالة محذوفة'
                        : last.body
                      : 'لا توجد رسائل بعد.'}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
