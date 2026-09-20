import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireAuthenticated } from '@/lib/permissions';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';

export const runtime = 'nodejs';

const schema = z.object({ tournamentId: z.string().uuid() });

const MESSAGES: Record<string, string> = {
  CHECK_IN_NOT_OPEN: 'لم تبدأ مرحلة تأكيد الحضور',
  CHECK_IN_WINDOW_CLOSED: 'انتهت فترة تأكيد الحضور',
  NOT_REGISTERED: 'أنت غير مسجل في هذه البطولة',
  NOT_ELIGIBLE: 'لا يمكنك تأكيد الحضور في حالتك الحالية',
  TOURNAMENT_NOT_FOUND: 'البطولة غير موجودة',
};

export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const { tournamentId } = await parseBody(request, schema);

    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('check_in_tournament', {
      p_tournament_id: tournamentId,
    });

    if (error) throw new Error(error.message);

    const result = data as { ok: boolean; error?: string; checked_in_at?: string };
    if (!result.ok) {
      const code = result.error ?? 'CHECK_IN_FAILED';
      return fail(code, MESSAGES[code] ?? 'تعذر تأكيد الحضور', 409);
    }

    return ok({ checkedInAt: result.checked_in_at });
  } catch (error) {
    return handleRouteError(error);
  }
}
