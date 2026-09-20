import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTournamentAdmin, writeAuditLog } from '@/lib/permissions';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';

export const runtime = 'nodejs';

const schema = z.object({
  playerId: z.string().uuid(),
  action: z.enum(['approve', 'reject', 'remove', 'disqualify', 'mark_no_show', 'reinstate']),
  reason: z.string().max(500).optional().nullable(),
});

const STATUS_BY_ACTION = {
  approve: 'approved',
  reject: 'rejected',
  remove: 'withdrawn',
  disqualify: 'disqualified',
  mark_no_show: 'no_show',
  reinstate: 'approved',
} as const;

/**
 * Roster management.
 *
 * Removing a player frees their slot through the same counter trigger that
 * enforces capacity, so the tournament can never end up over- or
 * under-counted after a roster change.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireTournamentAdmin(id);
    const input = await parseBody(request, schema);

    if (
      (input.action === 'disqualify' || input.action === 'remove') &&
      (!input.reason || input.reason.trim().length < 5)
    ) {
      return fail('REASON_REQUIRED', 'سبب القرار مطلوب', 422);
    }

    const admin = createAdminClient();
    const { data: player } = await admin
      .from('tournament_players')
      .select('id, user_id, status')
      .eq('tournament_id', id)
      .eq('user_id', input.playerId)
      .maybeSingle();

    if (!player) return fail('NOT_FOUND', 'اللاعب غير مسجل في هذه البطولة', 404);

    const nextStatus = STATUS_BY_ACTION[input.action];
    const now = new Date().toISOString();
    const reinstating = input.action === 'approve' || input.action === 'reinstate';
    const removing =
      input.action === 'remove' || input.action === 'disqualify' || input.action === 'reject';

    const patch = {
      status: nextStatus,
      ...(reinstating
        ? { approved_at: now, approved_by: user.id, removed_at: null, removal_reason: null }
        : {}),
      ...(removing ? { removed_at: now, removal_reason: input.reason ?? null } : {}),
    };

    const { error } = await admin
      .from('tournament_players')
      .update(patch)
      .eq('id', player.id);

    if (error) return fail('ROSTER_UPDATE_REJECTED', error.message, 409);

    await writeAuditLog({
      tournamentId: id,
      actorId: user.id,
      action:
        input.action === 'approve'
          ? 'PLAYER_APPROVED'
          : input.action === 'disqualify'
            ? 'PLAYER_DISQUALIFIED'
            : 'PLAYER_REMOVED',
      entityType: 'tournament_player',
      entityId: player.id,
      reason: input.reason ?? undefined,
      before: { status: player.status },
      after: { status: nextStatus },
    });

    return ok({ status: nextStatus });
  } catch (error) {
    return handleRouteError(error);
  }
}
