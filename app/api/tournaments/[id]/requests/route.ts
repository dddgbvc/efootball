import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTournamentAdmin } from '@/lib/permissions';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { notifyPlayers } from '@/lib/push/send';

export const runtime = 'nodejs';

const schema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(300).optional(),
});

/**
 * The organiser's decision on a join request.
 *
 * The decision is taken inside approve_join_request(), which holds the
 * tournament row lock while it checks capacity and writes the roster — the
 * same pairing that makes over-registration impossible. This handler chooses
 * *who* may ask for it and tells the player afterwards; it does not decide
 * anything itself.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: tournamentId } = await context.params;
    await requireTournamentAdmin(tournamentId);
    const input = await parseBody(request, schema);

    const supabase = await createServerSupabase();

    const { data, error } =
      input.action === 'approve'
        ? await supabase.rpc('approve_join_request', { p_request_id: input.requestId })
        : await supabase.rpc('reject_join_request', {
            p_request_id: input.requestId,
            p_note: input.note ?? null,
          });

    if (error) return fail('DECISION_FAILED', 'تعذر تنفيذ القرار', 500);

    const result = data as { ok?: boolean; error?: string; user_id?: string } | null;
    if (!result?.ok) {
      return fail(result?.error ?? 'DECISION_FAILED', undefined, 409);
    }

    const { data: tournament } = await supabase
      .from('tournaments')
      .select('name')
      .eq('id', tournamentId)
      .maybeSingle();

    const name = tournament?.name ?? 'البطولة';

    if (result.user_id) {
      await notifyPlayers([
        input.action === 'approve'
          ? {
              userId: result.user_id,
              tournamentId,
              type: 'join_request_approved',
              title: 'تم قبولك في البطولة',
              body: `أنت الآن مشارك في ${name}.`,
              link: '/player',
              eventKey: `join_approved:${input.requestId}`,
            }
          : {
              userId: result.user_id,
              tournamentId,
              type: 'join_request_rejected',
              title: 'لم يُقبل طلبك',
              body: input.note ? `${name}: ${input.note}` : `لم يُقبل طلب انضمامك إلى ${name}.`,
              link: '/player/join',
              eventKey: `join_rejected:${input.requestId}`,
            },
      ]);
    }

    return ok({ action: input.action });
  } catch (error) {
    return handleRouteError(error);
  }
}
