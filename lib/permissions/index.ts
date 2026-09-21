import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/server';

/**
 * A query that could not be answered is not an answer of "no".
 *
 * Every check below reads through the service-role client. When that client
 * cannot reach the database — a missing or wrong SUPABASE_SERVICE_ROLE_KEY is
 * the usual reason — postgrest-js returns an error and a null body rather than
 * throwing. Treating that as "you are not an admin" turns a configuration
 * problem into an accusation against the person using the app, who then has no
 * way to tell the two apart. This raises instead, and the route reports a
 * server error.
 */
function must<T>(
  result: { data: T; error: { message: string } | null },
  what: string,
): T {
  if (result.error) {
    throw new Error(`PERMISSION_LOOKUP_FAILED: ${what}: ${result.error.message}`);
  }
  return result.data;
}

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

  const [adminRowResult, tournamentResult, profileResult] = await Promise.all([
    admin
      .from('tournament_admins')
      .select('user_id')
      .eq('tournament_id', tournamentId)
      .eq('user_id', userId)
      .maybeSingle(),
    admin.from('tournaments').select('created_by').eq('id', tournamentId).maybeSingle(),
    admin.from('profiles').select('is_platform_admin').eq('id', userId).maybeSingle(),
  ]);

  const adminRow = must(adminRowResult, 'tournament_admins');
  const tournament = must(tournamentResult, 'tournaments');
  const profile = must(profileResult, 'profiles');

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
  const data = must(
    await admin
      .from('tournament_players')
      .select('status')
      .eq('tournament_id', tournamentId)
      .eq('user_id', userId)
      .maybeSingle(),
    'tournament_players',
  );

  return (
    data !== null &&
    ['registered', 'approved', 'checked_in', 'no_show'].includes(data.status as string)
  );
}

export async function requireMatchParticipant(matchId: string) {
  const user = await requireAuthenticated();
  const admin = createAdminClient();

  const match = must(
    await admin
      .from('matches')
      .select('id, tournament_id, player_a, player_b, status')
      .eq('id', matchId)
      .maybeSingle(),
    'matches',
  );

  if (!match) throw new AuthorizationError('NOT_FOUND', 'المباراة غير موجودة');
  if (match.player_a !== user.id && match.player_b !== user.id) {
    throw new AuthorizationError('FORBIDDEN', 'لست طرفاً في هذه المباراة');
  }

  return { user, match };
}

export async function requireChatMember(roomId: string) {
  const user = await requireAuthenticated();
  const admin = createAdminClient();

  const data = must(
    await admin
      .from('chat_room_members')
      .select('role')
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .maybeSingle(),
    'chat_room_members',
  );

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
