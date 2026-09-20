import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/server';

export class AuthorizationError extends Error {
  constructor(
    public readonly code:
      | 'UNAUTHENTICATED'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'INVALID_STATE'
      | 'VALIDATION_FAILED',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AuthorizationError';
  }
}

/**
 * Every privileged server route starts here.
 *
 * The service-role client is only ever handed out *after* one of these checks
 * has resolved the caller's real identity and role from the database. Nothing
 * about the caller's claims — not a header, not JWT metadata, not a body field
 * — participates in the decision.
 */
export async function requireAuthenticated() {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError('UNAUTHENTICATED');
  return user;
}

export async function isTournamentAdmin(tournamentId: string, userId: string): Promise<boolean> {
  const admin = createAdminClient();

  const [{ data: adminRow }, { data: tournament }, { data: profile }] = await Promise.all([
    admin
      .from('tournament_admins')
      .select('user_id')
      .eq('tournament_id', tournamentId)
      .eq('user_id', userId)
      .maybeSingle(),
    admin.from('tournaments').select('created_by').eq('id', tournamentId).maybeSingle(),
    admin.from('profiles').select('is_platform_admin').eq('id', userId).maybeSingle(),
  ]);

  return Boolean(adminRow) || tournament?.created_by === userId || profile?.is_platform_admin === true;
}

export async function requireTournamentAdmin(tournamentId: string) {
  const user = await requireAuthenticated();
  if (!(await isTournamentAdmin(tournamentId, user.id))) {
    throw new AuthorizationError('FORBIDDEN', 'ليست لديك صلاحية إدارة هذه البطولة');
  }
  return user;
}

export async function isTournamentParticipant(
  tournamentId: string,
  userId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('tournament_players')
    .select('status')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .maybeSingle();

  return (
    data !== null &&
    ['registered', 'approved', 'checked_in', 'no_show'].includes(data.status as string)
  );
}

export async function requireMatchParticipant(matchId: string) {
  const user = await requireAuthenticated();
  const admin = createAdminClient();

  const { data: match } = await admin
    .from('matches')
    .select('id, tournament_id, player_a, player_b, status')
    .eq('id', matchId)
    .maybeSingle();

  if (!match) throw new AuthorizationError('NOT_FOUND', 'المباراة غير موجودة');
  if (match.player_a !== user.id && match.player_b !== user.id) {
    throw new AuthorizationError('FORBIDDEN', 'لست طرفاً في هذه المباراة');
  }

  return { user, match };
}

export async function requireChatMember(roomId: string) {
  const user = await requireAuthenticated();
  const admin = createAdminClient();

  const { data } = await admin
    .from('chat_room_members')
    .select('role')
    .eq('room_id', roomId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!data) throw new AuthorizationError('FORBIDDEN', 'ليست لديك صلاحية الوصول لهذه المحادثة');
  return { user, role: data.role };
}

export async function writeAuditLog(entry: {
  tournamentId?: string | null;
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from('audit_logs').insert({
    tournament_id: entry.tournamentId ?? null,
    actor_id: entry.actorId ?? null,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    reason: entry.reason ?? null,
    before_state: (entry.before ?? null) as never,
    after_state: (entry.after ?? null) as never,
  });
}
