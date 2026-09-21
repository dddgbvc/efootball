import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyPlayers } from '@/lib/push/send';
import { requireAuthenticated } from '@/lib/permissions';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';

export const runtime = 'nodejs';

const schema = z.object({
  tournamentId: z.string().uuid(),
  rulesVersion: z.number().int().min(1),
  accepted: z.boolean(),
});

/**
 * Records a rules decision.
 *
 * The insert runs under the player's own session, so the three things that
 * matter — that they are recording it for themselves, that they belong to the
 * tournament, and that the version exists — are checked by the policy rather
 * than by this handler. The version is re-read here as well so a player who
 * left the page open is told the rules moved instead of silently accepting a
 * document that no longer exists.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuthenticated();
    const input = await parseBody(request, schema);

    const supabase = await createServerSupabase();

    const { data: rules } = await supabase
      .from('tournament_rules')
      .select('version')
      .eq('tournament_id', input.tournamentId)
      .maybeSingle();

    if (!rules) return fail('NOT_FOUND', 'البطولة غير موجودة', 404);

    if (rules.version !== input.rulesVersion) {
      return fail(
        'RULES_CHANGED',
        'تم تحديث القوانين أثناء قراءتك. أعد تحميل الصفحة وراجع النسخة الجديدة.',
        409,
      );
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from('tournament_rule_acceptances').insert({
      tournament_id: input.tournamentId,
      user_id: user.id,
      rules_version: rules.version,
      accepted: input.accepted,
      accepted_at: input.accepted ? now : null,
      declined_at: input.accepted ? null : now,
    });

    if (error) {
      return fail('FORBIDDEN', 'تعذر تسجيل قرارك على هذه البطولة', 403);
    }

    // The organiser is told either way: a decline is not a silent state, it is
    // something they have to act on.
    await notifyOrganisers(input.tournamentId, user.id, input.accepted);

    return ok({ accepted: input.accepted }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

async function notifyOrganisers(tournamentId: string, userId: string, accepted: boolean) {
  try {
    const admin = createAdminClient();

    const [{ data: admins }, { data: profile }] = await Promise.all([
      admin.from('tournament_admins').select('user_id').eq('tournament_id', tournamentId),
      admin.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
    ]);

    const name = profile?.display_name ?? 'لاعب';
    await notifyPlayers(
      (admins ?? []).map((row) => ({
        userId: row.user_id,
        tournamentId,
        type: accepted ? 'rules_accepted' : 'rules_declined',
        title: accepted ? 'موافقة على القوانين' : 'رفض القوانين',
        body: accepted
          ? `${name} وافق على قوانين البطولة.`
          : `${name} لم يوافق على قوانين البطولة.`,
        link: `/admin/tournaments/${tournamentId}/players`,
        eventKey: `rules_decision:${tournamentId}:${userId}:${accepted}`,
      })),
    );
  } catch (error) {
    // The decision is recorded; failing to tell the organiser must not undo it.
    console.error('[rules-decision-notify]', error);
  }
}
