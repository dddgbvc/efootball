import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuthenticated, requireTournamentAdmin, writeAuditLog } from '@/lib/permissions';
import { moderationReportSchema } from '@/lib/validation/schemas';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticated();
    const input = await parseBody(request, moderationReportSchema);

    const limit = rateLimit(`report:${user.id}`, 20, 60 * 60 * 1000);
    if (!limit.allowed) return fail('RATE_LIMITED', 'عدد كبير من البلاغات', 429);

    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('moderation_reports')
      .insert({
        target: input.target,
        target_id: input.targetId,
        tournament_id: input.tournamentId ?? null,
        reporter_id: user.id,
        reason: input.reason,
      })
      .select('id')
      .maybeSingle();

    if (error || !data) return fail('ALREADY_REPORTED', 'سبق أن أبلغت عن هذا المحتوى', 409);

    return ok({ reportId: data.id }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

const actionSchema = z.object({
  reportId: z.string().uuid(),
  tournamentId: z.string().uuid(),
  action: z.enum(['ignore', 'delete_content', 'warn', 'mute']),
  note: z.string().max(500).optional().nullable(),
  muteMinutes: z.number().int().min(5).max(60 * 24 * 30).optional().nullable(),
});

export async function PATCH(request: Request) {
  try {
    const input = await parseBody(request, actionSchema);
    const user = await requireTournamentAdmin(input.tournamentId);

    const admin = createAdminClient();
    const { data: report } = await admin
      .from('moderation_reports')
      .select('id, target, target_id, reported_user, tournament_id, status')
      .eq('id', input.reportId)
      .eq('tournament_id', input.tournamentId)
      .maybeSingle();

    if (!report) return fail('NOT_FOUND', 'البلاغ غير موجود', 404);
    if (report.status !== 'open') return fail('ALREADY_HANDLED', 'تمت معالجة البلاغ', 409);

    if (input.action === 'delete_content') {
      if (report.target === 'news_post') {
        await admin.from('news_posts').update({ status: 'archived' }).eq('id', report.target_id);
      } else if (report.target === 'chat_message') {
        await admin
          .from('chat_messages')
          .update({ deleted_at: new Date().toISOString(), deleted_by: user.id, body: null })
          .eq('id', report.target_id);
        await admin.from('chat_message_attachments').delete().eq('message_id', report.target_id);
      }
    }

    if (input.action === 'mute' && report.reported_user) {
      const { data: room } = await admin
        .from('chat_rooms')
        .select('id')
        .eq('tournament_id', input.tournamentId)
        .eq('type', 'tournament_group')
        .maybeSingle();

      if (room) {
        await admin.from('chat_mutes').upsert({
          room_id: room.id,
          user_id: report.reported_user,
          muted_until: new Date(
            Date.now() + (input.muteMinutes ?? 60) * 60 * 1000,
          ).toISOString(),
          muted_by: user.id,
          reason: input.note ?? null,
        });
      }
    }

    if (input.action === 'warn' && report.reported_user) {
      await admin.from('notifications').insert({
        user_id: report.reported_user,
        tournament_id: input.tournamentId,
        type: 'moderation_warning',
        title: 'تنبيه من إدارة البطولة',
        body: input.note ?? 'يرجى الالتزام بقوانين المجتمع.',
        event_key: `warn:${report.id}`,
      });
    }

    await admin
      .from('moderation_reports')
      .update({
        status: input.action === 'ignore' ? 'ignored' : 'actioned',
        handled_by: user.id,
        handled_at: new Date().toISOString(),
        action_taken: input.action,
      })
      .eq('id', report.id);

    await writeAuditLog({
      tournamentId: input.tournamentId,
      actorId: user.id,
      action: report.target === 'news_post' ? 'NEWS_MODERATED' : 'CHAT_MESSAGE_MODERATED',
      entityType: report.target,
      entityId: report.target_id,
      reason: input.note ?? undefined,
      after: { action: input.action },
    });

    return ok({ handled: input.action });
  } catch (error) {
    return handleRouteError(error);
  }
}
