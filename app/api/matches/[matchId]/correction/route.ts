import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  requireMatchParticipant,
  requireTournamentAdmin,
  writeAuditLog,
  AuthorizationError,
} from '@/lib/permissions';
import { correctionRequestSchema } from '@/lib/validation/schemas';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { notifyTournamentAdmins } from '@/lib/telegram/notify';
import { correctionRequestMessage } from '@/lib/telegram/messages';

export const runtime = 'nodejs';

/** A player asks for their submitted evidence to be reopened (§39). */
export async function POST(request: Request, context: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await context.params;
    const { user, match } = await requireMatchParticipant(matchId);
    const input = await parseBody(request, correctionRequestSchema);

    if (input.matchId !== matchId) return fail('MATCH_MISMATCH', 'معرّف غير مطابق', 400);

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('evidence_correction_requests')
      .insert({ match_id: matchId, requested_by: user.id, reason: input.reason })
      .select('id')
      .maybeSingle();

    if (error || !data) {
      return fail('CORRECTION_PENDING', 'لديك طلب تصحيح قيد المراجعة بالفعل', 409);
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();

    await notifyTournamentAdmins(
      match.tournament_id,
      `correction:${data.id}`,
      correctionRequestMessage({
        tournamentId: match.tournament_id,
        matchId,
        player: profile?.display_name ?? 'لاعب',
        reason: input.reason,
      }),
    );

    return ok({ requestId: data.id }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

const reviewSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(500).optional().nullable(),
});

/**
 * Admin decision on a correction request.
 *
 * Approving does not delete or edit anything: it bumps the submission's version
 * so the next upload lands as a new immutable row, and the previous evidence
 * plus its extraction stay on record.
 */
export async function PATCH(request: Request, context: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await context.params;

    const admin = createAdminClient();
    const { data: match } = await admin
      .from('matches')
      .select('id, tournament_id, status')
      .eq('id', matchId)
      .maybeSingle();
    if (!match) throw new AuthorizationError('NOT_FOUND');

    const user = await requireTournamentAdmin(match.tournament_id);
    const input = await parseBody(request, reviewSchema);

    const { data: correction } = await admin
      .from('evidence_correction_requests')
      .select('id, requested_by, status')
      .eq('id', input.requestId)
      .eq('match_id', matchId)
      .maybeSingle();

    if (!correction) return fail('NOT_FOUND', 'الطلب غير موجود', 404);
    if (correction.status !== 'pending') return fail('ALREADY_REVIEWED', 'تمت مراجعة الطلب', 409);

    await admin
      .from('evidence_correction_requests')
      .update({
        status: input.decision,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_note: input.note ?? null,
      })
      .eq('id', correction.id);

    if (input.decision === 'approved') {
      const { data: submission } = await admin
        .from('match_submissions')
        .select('id, current_version, reopened_count')
        .eq('match_id', matchId)
        .eq('user_id', correction.requested_by)
        .maybeSingle();

      if (submission) {
        await admin
          .from('match_submissions')
          .update({
            current_version: submission.current_version + 1,
            reopened_count: submission.reopened_count + 1,
          })
          .eq('id', submission.id);
      }

      if (!['verified', 'completed', 'cancelled'].includes(match.status)) {
        await admin
          .from('matches')
          .update({ status: 'awaiting_second_evidence' })
          .eq('id', matchId);
      }

      await admin.from('notifications').insert({
        user_id: correction.requested_by,
        tournament_id: match.tournament_id,
        type: 'correction_approved',
        title: 'تمت الموافقة على طلب التصحيح',
        body: 'يمكنك الآن إرسال صورة التوثيق مرة أخرى.',
        link: `/match/${matchId}`,
        event_key: `correction_approved:${correction.id}`,
      });
    }

    await writeAuditLog({
      tournamentId: match.tournament_id,
      actorId: user.id,
      action:
        input.decision === 'approved'
          ? 'EVIDENCE_RESUBMISSION_APPROVED'
          : 'EVIDENCE_RESUBMISSION_REJECTED',
      entityType: 'evidence_correction_request',
      entityId: correction.id,
      reason: input.note ?? undefined,
    });

    return ok({ decision: input.decision });
  } catch (error) {
    return handleRouteError(error);
  }
}
