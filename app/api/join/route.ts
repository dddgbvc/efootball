import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAuthenticated } from '@/lib/permissions';
import { joinTournamentSchema } from '@/lib/validation/schemas';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { notifyTournamentAdmins } from '@/lib/telegram/notify';
import { playerJoinedMessage } from '@/lib/telegram/messages';

export const runtime = 'nodejs';

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'يجب تسجيل الدخول أولاً',
  PROFILE_REQUIRED: 'أكمل ملفك الشخصي قبل الانضمام',
  TOURNAMENT_NOT_FOUND: 'البطولة غير موجودة',
  REGISTRATION_CLOSED: 'التسجيل مغلق',
  REGISTRATION_NOT_OPEN_YET: 'لم يفتح التسجيل بعد',
  ALREADY_JOINED: 'أنت مشارك في هذه البطولة بالفعل',
  INVITE_REQUIRED: 'هذه البطولة بالدعوة فقط',
  INVITE_INVALID: 'الدعوة غير صالحة',
  INVITE_REVOKED: 'تم إلغاء هذه الدعوة',
  INVITE_EXPIRED: 'انتهت صلاحية الدعوة',
  INVITE_EXHAUSTED: 'تم استخدام هذه الدعوة بالكامل',
  TOURNAMENT_FULL: 'اكتمل عدد المشاركين',
};

/**
 * Joining is delegated wholesale to public.join_tournament(), which runs under
 * a row lock on the tournament and enforces capacity with a CHECK constraint.
 *
 * The RPC executes as the signed-in user (not the service role), so the
 * function's own auth.uid() check is the identity — the request body cannot
 * name a different player.
 */
export async function POST(request: Request) {
  try {
    await requireAuthenticated();
    const input = await parseBody(request, joinTournamentSchema);

    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('join_tournament', {
      p_tournament_id: input.tournamentId,
      p_invite_token: input.inviteToken ?? null,
    });

    if (error) throw new Error(`JOIN_RPC_FAILED: ${error.message}`);

    const result = data as {
      ok: boolean;
      error?: string;
      player_count?: number;
      capacity?: number;
      status?: string;
      waitlisted?: boolean;
    };

    if (!result.ok) {
      const code = result.error ?? 'JOIN_FAILED';
      return fail(
        code,
        ERROR_MESSAGES[code] ?? 'تعذر الانضمام',
        code === 'TOURNAMENT_FULL' || code === 'ALREADY_JOINED' ? 409 : 400,
      );
    }

    // Best-effort side effects. Failure here never undoes a valid registration.
    try {
      const admin = createAdminClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const [{ data: tournament }, { data: profile }] = await Promise.all([
        admin.from('tournaments').select('name').eq('id', input.tournamentId).maybeSingle(),
        admin.from('profiles').select('display_name').eq('id', user!.id).maybeSingle(),
      ]);

      await notifyTournamentAdmins(
        input.tournamentId,
        `joined:${input.tournamentId}:${user!.id}`,
        playerJoinedMessage({
          tournamentName: tournament?.name ?? '',
          tournamentId: input.tournamentId,
          player: profile?.display_name ?? '',
          count: result.player_count ?? 0,
          capacity: result.capacity ?? 0,
        }),
      );

      // An invite that produced a player is claimed. The organiser's invite
      // list reads "تم التسجيل" from this, not from a guess.
      if (input.inviteToken) {
        await admin
          .from('tournament_invites')
          .update({ claimed_by: user!.id, claimed_at: new Date().toISOString() })
          .eq('token', input.inviteToken)
          .is('claimed_at', null);
      }

      await admin.rpc('post_system_message', {
        p_tournament_id: input.tournamentId,
        p_body: `👋 انضم ${profile?.display_name ?? 'لاعب'} إلى البطولة (${result.player_count}/${result.capacity})`,
        p_event: `player_joined:${user!.id}`,
      });
    } catch (sideEffectError) {
      console.error('[join] side effects failed', sideEffectError);
    }

    return ok({
      status: result.status,
      playerCount: result.player_count,
      capacity: result.capacity,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
