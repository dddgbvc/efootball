import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';

/**
 * RELEASE-BLOCKING registration concurrency test (§8).
 *
 * These assertions need a real PostgreSQL server because the guarantee under
 * test *is* the database: the row lock taken on `tournaments` plus the
 * `tournaments_player_count_within_capacity` CHECK. Nothing about it can be
 * demonstrated with an in-memory fake.
 *
 * The act under test is `public.approve_join_request()`. Since invitations were
 * removed it is the only way a row reaches `tournament_players` through the
 * application, so it is the only place a capacity ceiling can be crossed — and
 * an approval is not a solitary act the way a self-join was: two organisers
 * clicking "قبول" on the last seat at the same moment is the ordinary case,
 * not the exotic one.
 *
 * Run with:
 *   SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" \
 *     npm run test:db
 *
 * Without SUPABASE_DB_URL the suite is skipped rather than silently passing.
 */
const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

interface RpcResult {
  ok: boolean;
  error?: string;
  status?: string;
  player_count?: number;
  capacity?: number;
}

describeIfDb('registration capacity (live database)', () => {
  let pool: Pool;
  let adminId: string;
  const created: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 12 });

    // A fixture owner. auth.users is where profiles hang off; the bootstrap
    // trigger creates the profile row for us.
    const { rows } = await pool.query<{ id: string }>(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, raw_user_meta_data, created_at, updated_at)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', 'capacity-owner-' || gen_random_uuid() || '@test.invalid',
               '', now(), '{"display_name":"Capacity Owner"}'::jsonb, now(), now())
       returning id`,
    );
    adminId = rows[0]!.id;
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    // Audit rows deliberately survive their tournament, so nothing here has to
    // (or is able to) clear them.
    for (const id of created) {
      await pool.query('delete from public.tournaments where id = $1', [id]);
    }
    await pool.end();
  });

  async function makePlayers(count: number): Promise<string[]> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, raw_user_meta_data, created_at, updated_at)
       select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
              'authenticated', 'p' || g || '-' || gen_random_uuid() || '@test.invalid',
              '', now(), jsonb_build_object('display_name', 'Player ' || g), now(), now()
       from generate_series(1, $1) g
       returning id`,
      [count],
    );
    return rows.map((r) => r.id);
  }

  async function makeTournament(capacity: 8 | 16): Promise<string> {
    const slug = `cap-test-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const { rows } = await pool.query<{ id: string }>(
      `insert into public.tournaments (slug, name, capacity, created_by, status, visibility)
       values ($1, 'Capacity Test', $2, $3, 'registration_open', 'public')
       returning id`,
      [slug, capacity, adminId],
    );
    const id = rows[0]!.id;
    created.push(id);
    return id;
  }

  /**
   * Opens one connection standing in for a signed-in caller.
   *
   * This reproduces exactly what PostgREST does: assume the `authenticated`
   * role and publish the JWT claims the functions read through auth.uid().
   * Running as the pool's superuser instead would skip every policy, which is
   * most of what these tests exist to exercise.
   */
  async function asUser<T>(userId: string, run: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      await client.query(
        `select set_config('request.jwt.claims',
                           json_build_object('sub', $1::text, 'role', 'authenticated')::text,
                           false)`,
        [userId],
      );
      await client.query('set role authenticated');
      return await run(client);
    } finally {
      await client.end();
    }
  }

  /** The player asks, under their own session and their own insert policy. */
  async function requestAs(userId: string, tournamentId: string): Promise<string> {
    return asUser(userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.tournament_join_requests (tournament_id, user_id)
         values ($1, $2)
         on conflict (tournament_id, user_id) do update
           set status = 'pending', decided_at = null, decided_by = null, cancelled_at = null
         returning id`,
        [tournamentId, userId],
      );
      return rows[0]!.id;
    });
  }

  /** The organiser answers. This is the only door into the roster. */
  async function approveAs(actorId: string, requestId: string): Promise<RpcResult> {
    return asUser(actorId, async (client) => {
      const { rows } = await client.query<{ r: RpcResult }>(
        'select public.approve_join_request($1) as r',
        [requestId],
      );
      return rows[0]!.r;
    });
  }

  /** Ask and be answered — the whole path a player travels. */
  async function joinAs(userId: string, tournamentId: string): Promise<RpcResult> {
    return approveAs(adminId, await requestAs(userId, tournamentId));
  }

  it('accepts the 8th player and rejects the 9th', async () => {
    const tournamentId = await makeTournament(8);
    const players = await makePlayers(9);

    for (let i = 0; i < 8; i += 1) {
      const result = await joinAs(players[i]!, tournamentId);
      expect(result.ok).toBe(true);
    }

    const ninth = await joinAs(players[8]!, tournamentId);
    expect(ninth.ok).toBe(false);
    expect(ninth.error).toBe('TOURNAMENT_FULL');

    const { rows } = await pool.query<{ player_count: number }>(
      'select player_count from public.tournaments where id = $1',
      [tournamentId],
    );
    expect(rows[0]!.player_count).toBe(8);
  }, 90_000);

  it('accepts the 16th player and rejects the 17th', async () => {
    const tournamentId = await makeTournament(16);
    const players = await makePlayers(17);

    for (let i = 0; i < 16; i += 1) {
      expect((await joinAs(players[i]!, tournamentId)).ok).toBe(true);
    }

    const seventeenth = await joinAs(players[16]!, tournamentId);
    expect(seventeenth.ok).toBe(false);
    expect(seventeenth.error).toBe('TOURNAMENT_FULL');
  }, 180_000);

  it('lets exactly one of two simultaneous approvals take the final slot', async () => {
    const tournamentId = await makeTournament(8);
    const players = await makePlayers(9);

    // Fill 7 of 8.
    for (let i = 0; i < 7; i += 1) {
      expect((await joinAs(players[i]!, tournamentId)).ok).toBe(true);
    }

    // Both requests are waiting before either is answered, which is the state
    // the queue is actually in when an organiser reaches the bottom of it.
    const [requestA, requestB] = await Promise.all([
      requestAs(players[7]!, tournamentId),
      requestAs(players[8]!, tournamentId),
    ]);

    const [a, b] = await Promise.all([
      approveAs(adminId, requestA),
      approveAs(adminId, requestB),
    ]);

    const succeeded = [a, b].filter((r) => r.ok);
    const rejected = [a, b].filter((r) => !r.ok);

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.error).toBe('TOURNAMENT_FULL');

    const { rows } = await pool.query<{ player_count: number; actual: string }>(
      `select t.player_count,
              (select count(*) from public.tournament_players tp
                where tp.tournament_id = t.id) as actual
         from public.tournaments t where t.id = $1`,
      [tournamentId],
    );
    expect(rows[0]!.player_count).toBe(8);
    expect(Number(rows[0]!.actual)).toBe(8);
  }, 90_000);

  it('holds under a wider stampede for the last two slots', async () => {
    const tournamentId = await makeTournament(8);
    const players = await makePlayers(12);

    for (let i = 0; i < 6; i += 1) {
      expect((await joinAs(players[i]!, tournamentId)).ok).toBe(true);
    }

    const requests = await Promise.all(
      players.slice(6).map((player) => requestAs(player, tournamentId)),
    );
    const results = await Promise.all(requests.map((id) => approveAs(adminId, id)));

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok).every((r) => r.error === 'TOURNAMENT_FULL')).toBe(true);

    const { rows } = await pool.query<{ player_count: number }>(
      'select player_count from public.tournaments where id = $1',
      [tournamentId],
    );
    expect(rows[0]!.player_count).toBe(8);
  }, 120_000);

  it('rejects a duplicate membership', async () => {
    const tournamentId = await makeTournament(8);
    const [player] = await makePlayers(1);

    // Added to the roster by hand, the way an organiser enters a player they
    // already know. The request they had sent is now about a seat they hold.
    await pool.query(
      `insert into public.tournament_players (tournament_id, user_id, status)
       values ($1, $2, 'approved')`,
      [tournamentId, player],
    );

    const requestId = await requestAs(player!, tournamentId);
    const result = await approveAs(adminId, requestId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ALREADY_JOINED');

    const { rows } = await pool.query<{ player_count: number; status: string }>(
      `select t.player_count, r.status
         from public.tournaments t
         join public.tournament_join_requests r on r.id = $2
        where t.id = $1`,
      [tournamentId, requestId],
    );
    // One seat, and the request closed rather than left hanging in the queue.
    expect(rows[0]!.player_count).toBe(1);
    expect(rows[0]!.status).toBe('approved');
  }, 60_000);

  it('lets a turned-down player ask again, but never reopen an approval', async () => {
    const tournamentId = await makeTournament(8);
    const [player] = await makePlayers(1);

    const first = await requestAs(player!, tournamentId);
    await asUser(adminId, (client) =>
      client.query('select public.reject_join_request($1, $2)', [first, 'الاسم غير واضح']),
    );

    // Asking again clears the old decision instead of carrying it forward.
    const second = await requestAs(player!, tournamentId);
    expect(second).toBe(first);
    const { rows: reopened } = await pool.query<{
      status: string;
      decided_at: string | null;
      decision_note: string | null;
    }>('select status, decided_at, decision_note from public.tournament_join_requests where id = $1', [
      first,
    ]);
    expect(reopened[0]!.status).toBe('pending');
    expect(reopened[0]!.decided_at).toBeNull();
    expect(reopened[0]!.decision_note).toBeNull();

    // Accepted this time — and now the row is out of the player's reach.
    expect((await approveAs(adminId, second)).ok).toBe(true);
    await expect(requestAs(player!, tournamentId)).rejects.toThrow(/row-level security/i);
  }, 60_000);

  it('rejects an approval with no session behind it', async () => {
    const tournamentId = await makeTournament(8);
    const [player] = await makePlayers(1);
    const requestId = await requestAs(player!, tournamentId);

    const { rows } = await pool.query<{ r: RpcResult }>(
      'select public.approve_join_request($1) as r',
      [requestId],
    );
    expect(rows[0]!.r.ok).toBe(false);
    expect(rows[0]!.r.error).toBe('UNAUTHENTICATED');
  }, 30_000);

  it('refuses an approval from someone who does not run the tournament', async () => {
    const tournamentId = await makeTournament(8);
    const [player, outsider] = await makePlayers(2);
    const requestId = await requestAs(player!, tournamentId);

    const result = await approveAs(outsider!, requestId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('FORBIDDEN');

    // And a player cannot wave themselves in either.
    const self = await approveAs(player!, requestId);
    expect(self.ok).toBe(false);
    expect(self.error).toBe('FORBIDDEN');

    const { rows } = await pool.query<{ player_count: number }>(
      'select player_count from public.tournaments where id = $1',
      [tournamentId],
    );
    expect(rows[0]!.player_count).toBe(0);
  }, 60_000);

  it('refuses an approval once registration is no longer open', async () => {
    const tournamentId = await makeTournament(8);
    const [player] = await makePlayers(1);
    const requestId = await requestAs(player!, tournamentId);

    await pool.query("update public.tournaments set status = 'draft' where id = $1", [
      tournamentId,
    ]);

    const result = await approveAs(adminId, requestId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('REGISTRATION_CLOSED');
  }, 30_000);

  it('never lets the capacity ceiling be written past directly', async () => {
    const tournamentId = await makeTournament(8);
    const players = await makePlayers(9);

    for (let i = 0; i < 8; i += 1) {
      await joinAs(players[i]!, tournamentId);
    }

    // Bypassing the RPC entirely still trips the CHECK constraint.
    await expect(
      pool.query(
        `insert into public.tournament_players (tournament_id, user_id, status)
         values ($1, $2, 'approved')`,
        [tournamentId, players[8]],
      ),
    ).rejects.toThrow(/tournaments_player_count_within_capacity/);
  }, 90_000);
});
