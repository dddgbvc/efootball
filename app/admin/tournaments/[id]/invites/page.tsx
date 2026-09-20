import { createAdminClient } from '@/lib/supabase/admin';
import { inviteUrl, qrCodeSvg } from '@/lib/tournament/invites';
import { InviteManager } from '@/components/admin/InviteManager';

export const dynamic = 'force-dynamic';

export default async function AdminInvitesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const admin = createAdminClient();

  const { data } = await admin
    .from('tournament_invites')
    .select('id, label, token, code, max_uses, used_count, expires_at, revoked_at, auto_approve, created_at')
    .eq('tournament_id', id)
    .order('created_at', { ascending: false });

  const invites = await Promise.all(
    (data ?? []).map(async (invite) => ({
      id: invite.id,
      label: invite.label,
      code: invite.code,
      url: inviteUrl(invite.token),
      qrSvg: await qrCodeSvg(inviteUrl(invite.token), 180),
      maxUses: invite.max_uses,
      usedCount: invite.used_count,
      expiresAt: invite.expires_at,
      revokedAt: invite.revoked_at,
      autoApprove: invite.auto_approve,
    })),
  );

  return <InviteManager tournamentId={id} invites={invites} />;
}
