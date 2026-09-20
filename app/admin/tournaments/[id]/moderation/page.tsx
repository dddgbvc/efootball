import { createAdminClient } from '@/lib/supabase/admin';
import { ModerationQueue } from '@/components/admin/ModerationQueue';

export const dynamic = 'force-dynamic';

export default async function AdminModerationPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const admin = createAdminClient();

  const { data: reports } = await admin
    .from('moderation_reports')
    .select('id, target, target_id, reporter_id, reported_user, reason, status, created_at, action_taken')
    .eq('tournament_id', id)
    .order('status', { ascending: true })
    .order('created_at', { ascending: false });

  const userIds = [
    ...new Set(
      (reports ?? [])
        .flatMap((r) => [r.reporter_id, r.reported_user])
        .filter((x): x is string => x !== null),
    ),
  ];
  const { data: profiles } = userIds.length
    ? await admin.from('profiles').select('id, display_name').in('id', userIds)
    : { data: [] };

  const nameOf = (uid: string | null) =>
    uid ? (profiles?.find((p) => p.id === uid)?.display_name ?? '—') : '—';

  // Resolve the reported content so the admin decides on substance, not an id.
  const messageIds = (reports ?? [])
    .filter((r) => r.target === 'chat_message')
    .map((r) => r.target_id);
  const postIds = (reports ?? [])
    .filter((r) => r.target === 'news_post')
    .map((r) => r.target_id);

  const [{ data: messages }, { data: posts }] = await Promise.all([
    messageIds.length
      ? admin.from('chat_messages').select('id, body, deleted_at').in('id', messageIds)
      : Promise.resolve({ data: [] }),
    postIds.length
      ? admin.from('news_posts').select('id, body, status').in('id', postIds)
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <ModerationQueue
      tournamentId={id}
      rows={(reports ?? []).map((r) => ({
        id: r.id,
        target: r.target,
        targetId: r.target_id,
        reporter: nameOf(r.reporter_id),
        reportedUser: nameOf(r.reported_user),
        hasReportedUser: r.reported_user !== null,
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at,
        actionTaken: r.action_taken,
        content:
          r.target === 'chat_message'
            ? (messages?.find((m) => m.id === r.target_id)?.body ?? '[محذوفة]')
            : r.target === 'news_post'
              ? (posts?.find((p) => p.id === r.target_id)?.body ?? '[محذوف]')
              : null,
      }))}
    />
  );
}
