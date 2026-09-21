import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuthenticated } from '@/lib/permissions';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';
import { notifyPlayers } from '@/lib/push/send';

export const runtime = 'nodejs';

const lookupSchema = z.object({ code: z.string().trim().min(1).max(20) });

const createSchema = z.object({
  code: z.string().trim().min(1).max(20),
  message: z.string().trim().max(300).optional(),
});

/**
 * Looking a tournament up from a code.
 *
 * Rate limited because the code is the only thing standing between a stranger
 * and the knowledge that a tournament exists. Eight characters from a
 * 32-letter alphabet is a trillion possibilities, which is out of reach by
 * guessing — but not if the guessing is free.
 */
export async function PUT(request: Request) {
  try {
    const user = await requireAuthenticated();
    const limit = rateLimit(`code-lookup:${user.id}`, 20, 5 * 60 * 1000);
    if (!limit.allowed) {
      return fail('RATE_LIMITED', 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.', 429);
    }

    const input = await parseBody(request, lookupSchema);
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('find_tournament_by_code', { p_code: input.code });

    if (error) return fail('LOOKUP_FAILED', 'تعذر البحث عن الكود', 500);
    return ok({ result: data });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Asking to join. The organiser answers it; this only records the asking. */
export async function POST(request: Request) {
  try {
    const user = await requireAuthenticated();
    const limit = rateLimit(`join-request:${user.id}`, 10, 60 * 60 * 1000);
    if (!limit.allowed) {
      return fail('RATE_LIMITED', 'تجاوزت الحد المسموح، حاول لاحقاً', 429);
    }

    const input = await parseBody(request, createSchema);
    const supabase = await createServerSupabase();

    const { data: lookup } = await supabase.rpc('find_tournament_by_code', { p_code: input.code });
    const found = lookup as {
      ok?: boolean;
      error?: string;
      tournament_id?: string;
      accepting?: boolean;
      already_member?: boolean;
      existing_request?: string | null;
    } | null;

    if (!found?.ok || !found.tournament_id) {
      return fail(found?.error ?? 'CODE_NOT_FOUND', 'الكود غير صحيح', 404);
    }
    if (found.already_member) {
      return fail('ALREADY_JOINED', 'أنت مشارك في هذه البطولة بالفعل', 409);
    }
    if (!found.accepting) {
      return fail('REGISTRATION_CLOSED', 'التسجيل في هذه البطولة غير مفتوح حالياً', 409);
    }

    // A previous decision is not a wall: a withdrawn or rejected request can be
    // made again, because circumstances change and the organiser decides again.
    const { error } = await supabase.from('tournament_join_requests').upsert(
      {
        tournament_id: found.tournament_id,
        user_id: user.id,
        status: 'pending',
        message: input.message ?? null,
        decided_by: null,
        decided_at: null,
        decision_note: null,
        cancelled_at: null,
      },
      { onConflict: 'tournament_id,user_id' },
    );

    if (error) {
      return fail('REQUEST_FAILED', 'تعذر إرسال الطلب', 400);
    }

    await notifyOrganisers(found.tournament_id, user.id);

    return ok({ tournamentId: found.tournament_id }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Withdrawing. Allowed only while nobody has answered — the policy enforces it. */
export async function DELETE(request: Request) {
  try {
    await requireAuthenticated();
    const input = await parseBody(request, z.object({ requestId: z.string().uuid() }));

    const supabase = await createServerSupabase();
    const { error } = await supabase
      .from('tournament_join_requests')
      .update({ status: 'cancelled' })
      .eq('id', input.requestId);

    if (error) return fail('WITHDRAW_FAILED', 'تعذر سحب الطلب', 400);
    return ok({ withdrawn: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function notifyOrganisers(tournamentId: string, userId: string) {
  try {
    const admin = createAdminClient();
    const [{ data: admins }, { data: profile }, { data: tournament }] = await Promise.all([
      admin.from('tournament_admins').select('user_id').eq('tournament_id', tournamentId),
      admin.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
      admin.from('tournaments').select('name').eq('id', tournamentId).maybeSingle(),
    ]);

    await notifyPlayers(
      (admins ?? []).map((row) => ({
        userId: row.user_id,
        tournamentId,
        type: 'join_request_received',
        title: 'طلب انضمام جديد',
        body: `${profile?.display_name ?? 'لاعب'} يطلب الانضمام إلى ${tournament?.name ?? 'بطولتك'}.`,
        link: `/admin/tournaments/${tournamentId}/requests`,
        eventKey: `join_request:${tournamentId}:${userId}`,
      })),
    );
  } catch (error) {
    // The request is recorded; failing to ring the organiser must not undo it.
    console.error('[join-request-notify]', error);
  }
}
