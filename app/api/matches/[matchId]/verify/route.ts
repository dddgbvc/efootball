import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuthenticated, isTournamentAdmin, AuthorizationError } from '@/lib/permissions';
import { processMatchVerification } from '@/lib/ai/pipeline';
import { handleRouteError, ok, fail } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Re-runs the verification pipeline for a match.
 *
 * Safe to call any number of times: extractions are reused and the
 * cross-verification run is keyed on the exact evidence pair, so a retry after
 * an AI outage resumes rather than re-decides.
 */
export async function POST(_request: Request, context: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await context.params;
    const user = await requireAuthenticated();

    const admin = createAdminClient();
    const { data: match } = await admin
      .from('matches')
      .select('tournament_id, player_a, player_b')
      .eq('id', matchId)
      .maybeSingle();

    if (!match) throw new AuthorizationError('NOT_FOUND', 'المباراة غير موجودة');

    const isParticipant = match.player_a === user.id || match.player_b === user.id;
    if (!isParticipant && !(await isTournamentAdmin(match.tournament_id, user.id))) {
      throw new AuthorizationError('FORBIDDEN');
    }

    const limit = rateLimit(`verify:${matchId}`, 6, 10 * 60 * 1000);
    if (!limit.allowed) return fail('RATE_LIMITED', 'حاول مرة أخرى بعد قليل', 429);

    const outcome = await processMatchVerification(matchId);
    return ok({ outcome });
  } catch (error) {
    return handleRouteError(error);
  }
}
