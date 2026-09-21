import { createServerSupabase } from '@/lib/supabase/server';
import { requireTournamentAdmin } from '@/lib/permissions';
import { handleRouteError, ok, fail } from '@/lib/api/respond';

export const runtime = 'nodejs';

/** Rotating the code. The old one stops working the moment this returns. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await requireTournamentAdmin(id);

    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('rotate_join_code', { p_tournament_id: id });

    if (error) return fail('ROTATE_FAILED', 'تعذر توليد كود جديد', 500);

    const result = data as { ok?: boolean; join_code?: string; error?: string } | null;
    if (!result?.ok || !result.join_code) {
      return fail(result?.error ?? 'ROTATE_FAILED', 'تعذر توليد كود جديد', 409);
    }

    return ok({ joinCode: result.join_code });
  } catch (error) {
    return handleRouteError(error);
  }
}
