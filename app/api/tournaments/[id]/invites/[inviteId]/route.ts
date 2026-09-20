import { createAdminClient } from '@/lib/supabase/admin';
import { requireTournamentAdmin, writeAuditLog } from '@/lib/permissions';
import { handleRouteError, ok, fail } from '@/lib/api/respond';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; inviteId: string }> },
) {
  try {
    const { id, inviteId } = await context.params;
    const user = await requireTournamentAdmin(id);

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('tournament_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', inviteId)
      .eq('tournament_id', id)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return fail('NOT_FOUND', 'الدعوة غير موجودة أو ملغاة مسبقاً', 404);

    await writeAuditLog({
      tournamentId: id,
      actorId: user.id,
      action: 'INVITE_REVOKED',
      entityType: 'tournament_invite',
      entityId: inviteId,
    });

    return ok({ revoked: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
