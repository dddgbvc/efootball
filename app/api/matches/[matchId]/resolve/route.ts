import { createAdminClient } from '@/lib/supabase/admin';
import { requireTournamentAdmin, AuthorizationError } from '@/lib/permissions';
import { adminResolveSchema } from '@/lib/validation/schemas';
import { applyVerifiedResult } from '@/lib/ai/pipeline';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Administrator override — the final authority when AI is uncertain (§37, §40).
 *
 * A reason is mandatory and is written into the immutable audit log alongside
 * the previous and final results by apply_official_result().
 */
export async function POST(request: Request, context: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await context.params;

    const admin = createAdminClient();
    const { data: match } = await admin
      .from('matches')
      .select('id, tournament_id, status, tie_id, leg')
      .eq('id', matchId)
      .maybeSingle();

    if (!match) throw new AuthorizationError('NOT_FOUND', 'المباراة غير موجودة');

    const user = await requireTournamentAdmin(match.tournament_id);
    const input = await parseBody(request, adminResolveSchema);

    if (input.matchId !== matchId) return fail('MATCH_MISMATCH', 'معرّف المباراة غير مطابق', 400);
    if (match.status === 'cancelled') return fail('MATCH_CANCELLED', 'المباراة ملغاة', 409);

    // Extra time and penalties only ever decide the last leg of a tie.
    if (match.tie_id && match.leg === 1 && (input.extraTimeA !== null || input.penaltiesA !== null)) {
      return fail(
        'ET_NOT_ALLOWED_FIRST_LEG',
        'لا تُستخدم الأوقات الإضافية أو الترجيح في مباراة الذهاب',
        422,
      );
    }
    if (!match.tie_id && (input.extraTimeA != null || input.penaltiesA != null)) {
      return fail(
        'ET_NOT_ALLOWED_IN_LEAGUE',
        'مباريات الدوري لا تحتوي وقتاً إضافياً أو ركلات ترجيح',
        422,
      );
    }

    const outcome = await applyVerifiedResult({
      matchId,
      tournamentId: match.tournament_id,
      scoreA: input.scoreA,
      scoreB: input.scoreB,
      source: 'admin_override',
      actorId: user.id,
      note: input.reason,
      extraTimeA: input.extraTimeA ?? null,
      extraTimeB: input.extraTimeB ?? null,
      penaltiesA: input.penaltiesA ?? null,
      penaltiesB: input.penaltiesB ?? null,
    });

    return ok({ outcome });
  } catch (error) {
    return handleRouteError(error);
  }
}
