import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTournamentAdmin } from '@/lib/permissions';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { notifyPlayers } from '@/lib/push/send';

export const runtime = 'nodejs';

const schema = z.object({
  userId: z.string().uuid(),
  status: z.string().trim().min(1).max(60).nullable(),
  note: z.string().trim().max(400).nullable(),
  /** Never shown to the player. Kept in its own table, not on their row. */
  privateNote: z.string().trim().max(2000).nullable().optional(),
});

/**
 * The organiser writes a player's status; the player only ever reads it.
 *
 * The write goes through the service role because it also lands an audit entry
 * and a notification, neither of which a client session may insert. The
 * decision of *who may write* was already made by requireTournamentAdmin.
 */
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const { id: tournamentId } = await props.params;
    const actor = await requireTournamentAdmin(tournamentId);
    const input = await parseBody(request, schema);

    const admin = createAdminClient();

    const { data: before } = await admin
      .from('tournament_players')
      .select('id, public_status, public_note')
      .eq('tournament_id', tournamentId)
      .eq('user_id', input.userId)
      .maybeSingle();

    if (!before) return fail('NOT_FOUND', 'هذا اللاعب ليس في البطولة', 404);

    const now = new Date().toISOString();

    const { error } = await admin
      .from('tournament_players')
      .update({
        public_status: input.status,
        public_note: input.note,
        status_updated_by: actor.id,
        status_updated_at: now,
      })
      .eq('id', before.id);

    if (error) return fail('UPDATE_FAILED', 'تعذر تحديث حالة اللاعب', 400);

    if (input.privateNote !== undefined) {
      if (input.privateNote === null || input.privateNote === '') {
        await admin
          .from('player_admin_notes')
          .delete()
          .eq('tournament_id', tournamentId)
          .eq('user_id', input.userId);
      } else {
        await admin.from('player_admin_notes').upsert(
          {
            tournament_id: tournamentId,
            user_id: input.userId,
            note: input.privateNote,
            updated_by: actor.id,
            updated_at: now,
          },
          { onConflict: 'tournament_id,user_id' },
        );
      }
    }

    await admin.from('audit_logs').insert({
      tournament_id: tournamentId,
      actor_id: actor.id,
      action: 'PLAYER_STATUS_UPDATED',
      entity_type: 'tournament_player',
      entity_id: before.id,
      reason: input.status ?? 'cleared',
      before_state: { public_status: before.public_status, public_note: before.public_note },
      after_state: { public_status: input.status, public_note: input.note },
    });

    // The player is told, because a status they never see is not a status.
    if (input.status) {
      await notifyPlayers([
        {
          userId: input.userId,
          tournamentId,
          type: 'player_status_updated',
          title: 'تم تحديث حالتك',
          body: input.note ? `${input.status} — ${input.note}` : input.status,
          link: '/player',
        },
      ]);
    }

    return ok({ status: input.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
