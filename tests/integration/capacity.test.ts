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
 * Run with:
 *   SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" \
 *     npm run test:db
 *
 * Without SUPABASE_DB_URL the suite is skipped rather than silently passing.
 */
const DB_URL = process.env.SUPABASE_DB_URL;
const describeIfDb = DB_URL ? describe : describe.skip;

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

  /** Calls public.join_tournament() as a specific user, like PostgREST does. */
  async function joinAs(userId: string, tournamentId: string) {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      // Reproduce exactly what PostgREST does for a signed-in caller: assume
      // the `authenticated` role and publish the JWT claims the RPC reads.
      await client.query(
        `select set_config('request.jwt.claims',
                           json_build_object('sub', $1::text, 'role', 'authenticated')::text,
                           false)`,
        [userId],
      );
      await client.query('set role authenticated');
      const { rows } = await client.query<{ join_tournament: { ok: boolean; error?: string } }>(
        'select public.join_tournament($1, null) as join_tournament',
        [tournamentId],
      );
      return rows[0]!.join_tournament;
    } finally {
      await client.end();
    }
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
  }, 60_000);

  it('accepts the 16th player and rejects the 17th', async () => {
    const tournamentId = await makeTournament(16);
    const players = await makePlayers(17);

    for (let i = 0; i < 16; i += 1) {
      expect((await joinAs(players[i]!, tournamentId)).ok).toBe(true);
    }

    const seventeenth = await joinAs(players[16]!, tournamentId);
    expect(seventeenth.ok).toBe(false);
    expect(seventeenth.error).toBe('TOURNAMENT_FULL');
  }, 120_000);

  it('lets exactly one of two simultaneous requests take the final slot', async () => {
    const tournamentId = await makeTournament(8);
    const players = await makePlayers(9);

    // Fill 7 of 8.
    for (let i = 0; i < 7; i += 1) {
      expect((await joinAs(players[i]!, tournamentId)).ok).toBe(true);
    }

    // Player A and Player B race for slot 8.
    const [a, b] = await Promise.all([
      joinAs(players[7]!, tournamentId),
      joinAs(players[8]!, tournamentId),
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
  }, 60_000);

  it('holds under a wider stampede for the last two slots', async () => {
    const tournamentId = await makeTournament(8);
    const players = await makePlayers(12);

    for (let i = 0; i < 6; i += 1) {
      expect((await joinAs(players[i]!, tournamentId)).ok).toBe(true);
    }

    const results = await Promise.all(
      players.slice(6).map((player) => joinAs(player, tournamentId)),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok).every((r) => r.error === 'TOURNAMENT_FULL')).toBe(true);

    const { rows } = await pool.query<{ player_count: number }>(
      'select player_count from public.tournaments where id = $1',
      [tournamentId],
    );
    expect(rows[0]!.player_count).toBe(8);
  }, 90_000);

  it('rejects a duplicate membership', async () => {
    const tournamentId = await makeTournament(8);
    const [player] = await makePlayers(1);

    expect((await joinAs(player!, tournamentId)).ok).toBe(true);
    const second = await joinAs(player!, tournamentId);
    expect(second.ok).toBe(false);
    expect(second.error).toBe('ALREADY_JOINED');
  }, 30_000);

  it('rejects an unauthenticated join', async () => {
    const tournamentId = await makeTournament(8);
    const { rows } = await pool.query<{ r: { ok: boolean; error?: string } }>(
      "select public.join_tournament($1, null) as r",
      [tournamentId],
    );
    expect(rows[0]!.r.ok).toBe(false);
    expect(rows[0]!.r.error).toBe('UNAUTHENTICATED');
  }, 30_000);

  it('refuses a join once registration is no longer open', async () => {
    const tournamentId = await makeTournament(8);
    const [player] = await makePlayers(1);

    await pool.query("update public.tournaments set status = 'draft' where id = $1", [
      tournamentId,
    ]);

    const result = await joinAs(player!, tournamentId);
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
  }, 60_000);
});
