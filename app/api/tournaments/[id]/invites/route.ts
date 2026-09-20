import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTournamentAdmin, writeAuditLog, AuthorizationError } from '@/lib/permissions';
import {
  generateInviteCode,
  generateInviteToken,
  inviteUrl,
  qrCodeSvg,
} from '@/lib/tournament/invites';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';

export const runtime = 'nodejs';

const createSchema = z.object({
  label: z.string().max(60).optional().nullable(),
  maxUses: z.number().int().min(1).max(64).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  autoApprove: z.boolean().default(true),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await requireTournamentAdmin(id);

    const admin = createAdminClient();
    const { data } = await admin
      .from('tournament_invites')
      .select('id, label, token, code, max_uses, used_count, auto_approve, expires_at, revoked_at, created_at')
      .eq('tournament_id', id)
      .order('created_at', { ascending: false });

    const invites = await Promise.all(
      (data ?? []).map(async (invite) => ({
        ...invite,
        url: inviteUrl(invite.token),
        qrSvg: await qrCodeSvg(inviteUrl(invite.token), 200),
      })),
    );

    return ok({ invites });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireTournamentAdmin(id);

    const limit = rateLimit(`invite:${id}`, 30, 60 * 60 * 1000);
    if (!limit.allowed) return fail('RATE_LIMITED', 'تم إنشاء عدد كبير من الدعوات', 429);

    const input = await parseBody(request, createSchema);

    const admin = createAdminClient();
    const { data: tournament } = await admin
      .from('tournaments')
      .select('capacity')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) throw new AuthorizationError('NOT_FOUND');

    // Retry on the (tournament_id, code) collision rather than trusting a
    // single draw to be unique.
    let inserted = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      const { data, error } = await admin
        .from('tournament_invites')
        .insert({
          tournament_id: id,
          label: input.label ?? null,
          token: generateInviteToken(),
          code: generateInviteCode(tournament.capacity),
          max_uses: input.maxUses ?? null,
          expires_at: input.expiresAt ?? null,
          auto_approve: input.autoApprove,
          created_by: user.id,
        })
        .select('id, token, code, max_uses, expires_at, auto_approve')
        .maybeSingle();

      if (!error && data) inserted = data;
      else if (error && !error.message.includes('duplicate')) {
        throw new Error(`INVITE_INSERT_FAILED: ${error.message}`);
      }
    }

    if (!inserted) return fail('INVITE_CREATE_FAILED', 'تعذر إنشاء الدعوة، حاول مجدداً', 500);

    await writeAuditLog({
      tournamentId: id,
      actorId: user.id,
      action: 'INVITE_CREATED',
      entityType: 'tournament_invite',
      entityId: inserted.id,
      after: { label: input.label, maxUses: input.maxUses, expiresAt: input.expiresAt },
    });

    const url = inviteUrl(inserted.token);

    return ok(
      {
        invite: {
          ...inserted,
          url,
          qrSvg: await qrCodeSvg(url, 256),
        },
      },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
