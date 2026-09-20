import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { EmptyState } from '@/components/StandingsTable';

export const metadata = { title: 'الرسائل' };
export const dynamic = 'force-dynamic';

export default async function MessagesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/messages');

  const supabase = await createServerSupabase();

  // RLS restricts every one of these reads to rooms this user belongs to.
  const { data: memberships } = await supabase
    .from('chat_room_members')
    .select('room_id')
    .eq('user_id', user.id);

  const roomIds = (memberships ?? []).map((m) => m.room_id);

  if (roomIds.length === 0) {
    return (
      <div className="shell" style={{ paddingBlock: '40px 80px', maxWidth: 720 }}>
        <h1 style={{ fontSize: 30, marginBlockEnd: 24 }}>الرسائل</h1>
        <EmptyState>لا توجد محادثات بعد.</EmptyState>
      </div>
    );
  }

  const [{ data: rooms }, { data: lastMessages }, { data: readState }, { data: otherMembers }] =
    await Promise.all([
      supabase.from('chat_rooms').select('id, type, title, tournament_id').in('id', roomIds),
      supabase
        .from('chat_messages')
        .select('id, room_id, body, kind, created_at, sender_id')
        .in('room_id', roomIds)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('chat_read_state').select('room_id, last_read_at').eq('user_id', user.id),
      supabase
        .from('chat_room_members')
        .select('room_id, user_id')
        .in('room_id', roomIds)
        .neq('user_id', user.id),
    ]);

  const otherIds = [...new Set((otherMembers ?? []).map((m) => m.user_id))];
  const { data: profiles } = otherIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', otherIds)
    : { data: [] };

  const rows = (rooms ?? [])
    .map((room) => {
      const messages = (lastMessages ?? []).filter((m) => m.room_id === room.id);
      const last = messages[0];
      const lastRead = readState?.find((r) => r.room_id === room.id)?.last_read_at;
      const unread = messages.filter(
        (m) =>
          m.sender_id !== user.id &&
          (!lastRead || new Date(m.created_at) > new Date(lastRead)),
      ).length;

      const counterpartId =
        room.type === 'direct'
          ? (otherMembers ?? []).find((m) => m.room_id === room.id)?.user_id
          : null;

      return {
        id: room.id,
        title:
          room.type === 'tournament_group'
            ? (room.title ?? 'مجموعة البطولة')
            : (profiles?.find((p) => p.id === counterpartId)?.display_name ?? 'محادثة'),
        type: room.type,
        preview: last?.body ?? (last?.kind === 'system' ? 'رسالة نظام' : 'لا توجد رسائل'),
        at: last?.created_at ?? null,
        unread,
      };
    })
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));

  return (
    <div className="shell" style={{ paddingBlock: '40px 80px', maxWidth: 720 }}>
      <div className="eyebrow">المجتمع</div>
      <h1 style={{ fontSize: 30, marginBlock: '10px 24px' }}>الرسائل</h1>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/messages/${row.id}`}
              className="panel"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'center',
                padding: '14px 16px',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <strong>{row.title}</strong>
                  {row.type === 'tournament_group' ? (
                    <span className="tag">مجموعة</span>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.preview}
                </div>
              </div>
              {row.unread > 0 ? (
                <span
                  className="numeric"
                  style={{
                    minWidth: 22,
                    height: 22,
                    padding: '0 6px',
                    borderRadius: 11,
                    background: 'var(--accent)',
                    color: 'var(--accent-ink)',
                    fontSize: 11,
                    fontWeight: 800,
                    lineHeight: '22px',
                    textAlign: 'center',
                  }}
                >
                  {row.unread}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
