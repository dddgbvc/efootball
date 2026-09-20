import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTournamentAdmin, writeAuditLog, AuthorizationError } from '@/lib/permissions';
import { canTransition } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';

export const runtime = 'nodejs';

const schema = z.object({
  to: z.enum([
    'draft',
    'registration_open',
    'registration_full',
    'check_in',
    'ready_for_draw',
    'league_active',
    'playoffs',
    'semifinal',
    'final',
    'completed',
    'cancelled',
  ]),
});

/**
 * The only way a tournament changes state.
 *
 * The transition is checked here for a readable error and again by the
 * app.guard_tournament_status() trigger, which is what actually prevents a
 * client — admin or not — from forcing an illegal state.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireTournamentAdmin(id);
    const { to } = await parseBody(request, schema);

    const admin = createAdminClient();
    const { data: tournament } = await admin
      .from('tournaments')
      .select('id, status, player_count, capacity, check_in_opens_at')
      .eq('id', id)
      .maybeSingle();

    if (!tournament) throw new AuthorizationError('NOT_FOUND');

    const from = tournament.status as TournamentStatus;
    if (from === to) return ok({ status: to });

    if (!canTransition(from, to)) {
      return fail('INVALID_TRANSITION', `لا يمكن الانتقال من ${from} إلى ${to}`, 409);
    }

    if (to === 'ready_for_draw' && tournament.player_count < tournament.capacity) {
      return fail(
        'ROSTER_INCOMPLETE',
        `عدد المشاركين ${tournament.player_count} من ${tournament.capacity}`,
        409,
      );
    }

    const opensCheckIn = to === 'check_in' && !tournament.check_in_opens_at;
    const patch = {
      status: to,
      ...(opensCheckIn ? { check_in_opens_at: new Date().toISOString() } : {}),
    };

    const { error } = await admin.from('tournaments').update(patch).eq('id', id);
    if (error) return fail('TRANSITION_REJECTED', error.message, 409);

    await writeAuditLog({
      tournamentId: id,
      actorId: user.id,
      action: 'TOURNAMENT_STATUS_CHANGED',
      entityType: 'tournament',
      entityId: id,
      before: { status: from },
      after: { status: to },
    });

    if (to === 'check_in') {
      await admin.rpc('post_system_message', {
        p_tournament_id: id,
        p_body: '✋ بدأت مرحلة تأكيد الحضور. اضغط "أنا حاضر" لتأكيد مشاركتك.',
        p_event: 'check_in_started',
      });
    }

    return ok({ status: to });
  } catch (error) {
    return handleRouteError(error);
  }
}
