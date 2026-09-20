import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { generateDoubleRoundRobin, generateSingleRoundRobin } from '@/lib/league/scheduler';
import { openDraw, seededSemifinalDraw, type DrawResult } from '@/lib/bracket/draw';
import { tieLegFixtures } from '@/lib/bracket/knockout';
import { loadEligiblePlayerIds, loadRules, loadStandings } from './queries';
import { AuthorizationError, writeAuditLog } from '@/lib/permissions';
import { notifyTournamentAdmins } from '@/lib/telegram/notify';
import { drawCompletedMessage } from '@/lib/telegram/messages';
import { publishOfficialEvent } from '@/lib/news/publish';
import { classifyDraw, classifyQualification } from '@/lib/news/classify';

/**
 * Generates and persists the league schedule.
 *
 * Fixtures are written exactly once: the unique index
 * `matches_league_fixture_unique` makes a second run a no-op error rather than
 * a duplicated calendar, which is what keeps the schedule stable across page
 * refreshes and retries.
 */
export async function generateLeagueSchedule(tournamentId: string, actorId: string) {
  const admin = createAdminClient();

  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, name, status, capacity')
    .eq('id', tournamentId)
    .maybeSingle();

  if (!tournament) throw new AuthorizationError('NOT_FOUND', 'البطولة غير موجودة');
  if (!['ready_for_draw', 'registration_full', 'check_in'].includes(tournament.status)) {
    throw new AuthorizationError(
      'INVALID_STATE',
      'يجب أن تكون البطولة جاهزة للقرعة قبل توليد جدول الدوري',
    );
  }

  const { count: existing } = await admin
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('stage', 'league');

  if ((existing ?? 0) > 0) {
    throw new AuthorizationError('INVALID_STATE', 'جدول الدوري مولّد مسبقاً');
  }

  const rules = await loadRules(admin, tournamentId);
  const playerIds = await loadEligiblePlayerIds(admin, tournamentId);

  if (playerIds.length !== tournament.capacity) {
    throw new AuthorizationError(
      'INVALID_STATE',
      `عدد اللاعبين المؤهلين ${playerIds.length} بينما سعة البطولة ${tournament.capacity}`,
    );
  }

  const fixtures = rules.leagueDoubleRound
    ? generateDoubleRoundRobin(playerIds)
    : generateSingleRoundRobin(playerIds);

  const roundNumbers = [...new Set(fixtures.map((f) => f.roundNumber))].sort((a, b) => a - b);

  const { data: rounds, error: roundsError } = await admin
    .from('league_rounds')
    .insert(
      roundNumbers.map((n) => ({
        tournament_id: tournamentId,
        round_number: n,
        leg: fixtures.find((f) => f.roundNumber === n)!.leg,
        label: `الجولة ${n}`,
      })),
    )
    .select('id, round_number');

  if (roundsError) throw new Error(`ROUND_INSERT_FAILED: ${roundsError.message}`);

  const roundIdByNumber = new Map((rounds ?? []).map((r) => [r.round_number, r.id]));

  const { error: matchError } = await admin.from('matches').insert(
    fixtures.map((f) => ({
      tournament_id: tournamentId,
      stage: 'league' as const,
      round_id: roundIdByNumber.get(f.roundNumber) ?? null,
      round_number: f.roundNumber,
      leg: f.leg,
      player_a: f.playerA,
      player_b: f.playerB,
      status: 'ready' as const,
    })),
  );

  if (matchError) throw new Error(`FIXTURE_INSERT_FAILED: ${matchError.message}`);

  await admin.from('tournaments').update({ status: 'league_active' }).eq('id', tournamentId);

  await writeAuditLog({
    tournamentId,
    actorId,
    action: 'LEAGUE_SCHEDULE_GENERATED',
    entityType: 'tournament',
    entityId: tournamentId,
    after: { fixtures: fixtures.length, rounds: roundNumbers.length },
  });

  await admin.rpc('post_system_message', {
    p_tournament_id: tournamentId,
    p_body: `📅 تم توليد جدول الدوري: ${fixtures.length} مباراة على ${roundNumbers.length} جولة.`,
    p_event: 'league_generated',
  });

  return { fixtures: fixtures.length, rounds: roundNumbers.length };
}

/**
 * Runs the official playoff draw for the players ranked inside the playoff zone.
 *
 * Randomisation happens here, on the server, with a CSPRNG. The unique index on
 * `draws(tournament_id, kind)` makes the draw un-rerunnable, and the pairings
 * are persisted before the client is told anything.
 */
export async function executePlayoffDraw(tournamentId: string, actorId: string) {
  const admin = createAdminClient();

  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, name, status')
    .eq('id', tournamentId)
    .maybeSingle();
  if (!tournament) throw new AuthorizationError('NOT_FOUND');

  const rules = await loadRules(admin, tournamentId);
  const bundle = await loadStandings(admin, tournamentId);

  if (bundle.verifiedMatches < bundle.totalMatches) {
    throw new AuthorizationError(
      'INVALID_STATE',
      `لم تُوثَّق كل مباريات الدوري بعد (${bundle.verifiedMatches}/${bundle.totalMatches})`,
    );
  }
  if (bundle.qualification.unresolvedTies.length > 0) {
    throw new AuthorizationError(
      'INVALID_STATE',
      'يوجد تعادل غير محسوم في الترتيب يجب أن يحسمه المسؤول قبل القرعة',
    );
  }

  const pot = bundle.qualification.playoff;
  if (pot.length < 2) {
    throw new AuthorizationError('INVALID_STATE', 'لا يوجد عدد كافٍ من اللاعبين للتصفيات');
  }

  const result = openDraw(pot);

  await persistDraw(tournamentId, 'playoff', actorId, result, 'التصفيات');

  const ties = await createTiesForPairings(
    tournamentId,
    'playoff',
    result.pairings,
    rules.knockoutTwoLegs,
  );

  await admin.from('tournaments').update({ status: 'playoffs' }).eq('id', tournamentId);

  const names = await displayNames(result.order);
  const pairingNames = result.pairings.map((p) => ({
    playerA: names.get(p.playerA) ?? p.playerA,
    playerB: names.get(p.playerB) ?? p.playerB,
  }));

  await writeAuditLog({
    tournamentId,
    actorId,
    action: 'DRAW_EXECUTED',
    entityType: 'draw',
    entityId: `${tournamentId}:playoff`,
    after: { pairings: result.pairings, seedHash: result.seedHash },
  });

  await notifyTournamentAdmins(
    tournamentId,
    `draw:${tournamentId}:playoff`,
    drawCompletedMessage({
      tournamentName: tournament.name,
      tournamentId,
      kind: 'playoff',
      pairings: pairingNames,
    }),
  );

  await publishOfficialEvent(
    tournamentId,
    classifyQualification(
      tournamentId,
      tournament.name,
      bundle.qualification.directSemifinal.map((id) => names.get(id) ?? id),
      bundle.qualification.playoff.map((id) => names.get(id) ?? id),
      bundle.qualification.eliminated.map((id) => names.get(id) ?? id),
    ),
  );
  await publishOfficialEvent(
    tournamentId,
    classifyDraw(tournamentId, tournament.name, 'playoff', pairingNames),
  );

  await admin.rpc('post_system_message', {
    p_tournament_id: tournamentId,
    p_body: `🎲 اكتملت قرعة التصفيات:\n${pairingNames.map((p, i) => `${i + 1}. ${p.playerA} × ${p.playerB}`).join('\n')}`,
    p_event: 'playoff_draw',
  });

  return { pairings: result.pairings, ties, seedHash: result.seedHash };
}

/**
 * Builds the semifinals once both playoff ties are decided.
 *
 * Mode A keeps the two direct qualifiers apart; mode B puts all four into a
 * fresh open draw. The mode is a stored tournament rule, not a runtime choice.
 */
export async function executeSemifinalDraw(tournamentId: string, actorId: string) {
  const admin = createAdminClient();

  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, name, status')
    .eq('id', tournamentId)
    .maybeSingle();
  if (!tournament) throw new AuthorizationError('NOT_FOUND');

  const rules = await loadRules(admin, tournamentId);
  const bundle = await loadStandings(admin, tournamentId);

  const { data: playoffTies } = await admin
    .from('knockout_ties')
    .select('id, winner_id, status, position')
    .eq('tournament_id', tournamentId)
    .eq('stage', 'playoff')
    .order('position', { ascending: true });

  const winners = (playoffTies ?? []).map((t) => t.winner_id).filter((w): w is string => w !== null);

  if ((playoffTies ?? []).length > 0 && winners.length !== (playoffTies ?? []).length) {
    throw new AuthorizationError('INVALID_STATE', 'لم تُحسم كل مواجهات التصفيات بعد');
  }

  const seeds = bundle.qualification.directSemifinal;
  const entrants = [...seeds, ...winners];

  if (entrants.length !== 4) {
    throw new AuthorizationError(
      'INVALID_STATE',
      `عدد المتأهلين لنصف النهائي ${entrants.length} بدلاً من 4`,
    );
  }

  const result =
    rules.semifinalDrawMode === 'seeded'
      ? seededSemifinalDraw(seeds, winners)
      : openDraw(entrants);

  await persistDraw(tournamentId, 'semifinal', actorId, result, 'نصف النهائي');

  // Create the final first so the semifinal ties can point at it.
  const { data: finalTie, error: finalError } = await admin
    .from('knockout_ties')
    .insert({
      tournament_id: tournamentId,
      stage: 'final' as const,
      position: 1,
      label: 'النهائي',
      two_legs: rules.knockoutTwoLegs,
    })
    .select('id')
    .single();

  if (finalError) throw new Error(`FINAL_TIE_FAILED: ${finalError.message}`);

  const ties = await createTiesForPairings(
    tournamentId,
    'semifinal',
    result.pairings,
    rules.knockoutTwoLegs,
    finalTie.id,
  );

  await admin.from('tournaments').update({ status: 'semifinal' }).eq('id', tournamentId);

  const names = await displayNames(entrants);
  const pairingNames = result.pairings.map((p) => ({
    playerA: names.get(p.playerA) ?? p.playerA,
    playerB: names.get(p.playerB) ?? p.playerB,
  }));

  await writeAuditLog({
    tournamentId,
    actorId,
    action: 'DRAW_EXECUTED',
    entityType: 'draw',
    entityId: `${tournamentId}:semifinal`,
    after: { mode: rules.semifinalDrawMode, pairings: result.pairings },
  });

  await notifyTournamentAdmins(
    tournamentId,
    `draw:${tournamentId}:semifinal`,
    drawCompletedMessage({
      tournamentName: tournament.name,
      tournamentId,
      kind: 'semifinal',
      pairings: pairingNames,
    }),
  );

  await publishOfficialEvent(
    tournamentId,
    classifyDraw(tournamentId, tournament.name, 'semifinal', pairingNames),
  );

  await admin.rpc('post_system_message', {
    p_tournament_id: tournamentId,
    p_body: `🎲 نصف النهائي:\n${pairingNames.map((p) => `${p.playerA} × ${p.playerB}`).join('\n')}`,
    p_event: 'semifinal_draw',
  });

  return { pairings: result.pairings, ties };
}

async function persistDraw(
  tournamentId: string,
  kind: 'playoff' | 'semifinal' | 'final',
  actorId: string,
  result: DrawResult,
  potLabel: string,
) {
  const admin = createAdminClient();

  const { data: draw, error } = await admin
    .from('draws')
    .insert({
      tournament_id: tournamentId,
      kind,
      seed_hash: result.seedHash,
      executed_by: actorId,
      revealed_at: new Date().toISOString(),
      payload: { pairings: result.pairings, order: result.order } as never,
    })
    .select('id')
    .single();

  if (error) {
    throw new AuthorizationError('INVALID_STATE', 'تم إجراء هذه القرعة مسبقاً ولا يمكن إعادتها');
  }

  await admin.from('draw_entries').insert(
    result.pairings.flatMap((pair, index) => [
      {
        draw_id: draw.id,
        user_id: pair.playerA,
        pot_label: potLabel,
        slot_index: index * 2,
        pair_index: index + 1,
        side: 'a',
      },
      {
        draw_id: draw.id,
        user_id: pair.playerB,
        pot_label: potLabel,
        slot_index: index * 2 + 1,
        pair_index: index + 1,
        side: 'b',
      },
    ]),
  );

  return draw.id;
}

async function createTiesForPairings(
  tournamentId: string,
  stage: 'playoff' | 'semifinal' | 'final',
  pairings: Array<{ position: number; playerA: string; playerB: string }>,
  twoLegs: boolean,
  nextTieId?: string,
) {
  const admin = createAdminClient();

  const { data: ties, error } = await admin
    .from('knockout_ties')
    .insert(
      pairings.map((p) => ({
        tournament_id: tournamentId,
        stage,
        position: p.position,
        label: stage === 'playoff' ? `تصفيات ${p.position}` : `نصف نهائي ${p.position}`,
        player_a: p.playerA,
        player_b: p.playerB,
        two_legs: twoLegs,
        status: 'first_leg' as const,
        next_tie_id: nextTieId ?? null,
        next_tie_slot: nextTieId ? (p.position === 1 ? 'a' : 'b') : null,
      })),
    )
    .select('id, position, player_a, player_b');

  if (error) throw new Error(`TIE_INSERT_FAILED: ${error.message}`);

  const legs = (ties ?? []).flatMap((tie) =>
    tieLegFixtures(tie.player_a!, tie.player_b!, twoLegs).map((leg) => ({
      tournament_id: tournamentId,
      stage,
      tie_id: tie.id,
      leg: leg.leg,
      player_a: leg.playerA,
      player_b: leg.playerB,
      status: (leg.leg === 1 ? 'ready' : 'pending') as 'ready' | 'pending',
    })),
  );

  const { error: legError } = await admin.from('matches').insert(legs);
  if (legError) throw new Error(`LEG_INSERT_FAILED: ${legError.message}`);

  return ties ?? [];
}

async function displayNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const admin = createAdminClient();
  const { data } = await admin.from('profiles').select('id, display_name').in('id', userIds);
  return new Map((data ?? []).map((p) => [p.id, p.display_name]));
}

/**
 * Opens the second leg of a tie once the first leg is official, and keeps the
 * tournament stage in step with the bracket.
 */
export async function advanceAfterTie(tournamentId: string, tieId: string) {
  const admin = createAdminClient();

  const { data: tie } = await admin
    .from('knockout_ties')
    .select('id, stage, status, next_tie_id, winner_id')
    .eq('id', tieId)
    .maybeSingle();
  if (!tie) return;

  if (tie.status === 'second_leg') {
    await admin
      .from('matches')
      .update({ status: 'ready' })
      .eq('tie_id', tieId)
      .eq('leg', 2)
      .eq('status', 'pending');
  }

  if (tie.status !== 'completed') return;

  // When every tie in a stage is done, move the tournament on.
  const { data: siblings } = await admin
    .from('knockout_ties')
    .select('status')
    .eq('tournament_id', tournamentId)
    .eq('stage', tie.stage);

  const allDone = (siblings ?? []).every((s) => s.status === 'completed');
  if (!allDone) return;

  if (tie.stage === 'playoff') {
    // The semifinal draw is an explicit admin action, so only the stage moves.
    return;
  }

  if (tie.stage === 'semifinal') {
    await admin.from('tournaments').update({ status: 'final' }).eq('id', tournamentId);
    await admin
      .from('matches')
      .update({ status: 'ready' })
      .eq('tournament_id', tournamentId)
      .eq('stage', 'final')
      .eq('leg', 1)
      .eq('status', 'pending');
  }
}

/**
 * Creates the final's two legs once both semifinal winners are known.
 * The tie row already exists (built with the semifinal draw); this fills in its
 * fixtures.
 */
export async function materializeFinalLegs(tournamentId: string) {
  const admin = createAdminClient();

  const { data: finalTie } = await admin
    .from('knockout_ties')
    .select('id, player_a, player_b, two_legs')
    .eq('tournament_id', tournamentId)
    .eq('stage', 'final')
    .maybeSingle();

  if (!finalTie?.player_a || !finalTie.player_b) return null;

  const { count } = await admin
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tie_id', finalTie.id);

  if ((count ?? 0) > 0) return finalTie.id;

  const legs = tieLegFixtures(finalTie.player_a, finalTie.player_b, finalTie.two_legs).map(
    (leg) => ({
      tournament_id: tournamentId,
      stage: 'final' as const,
      tie_id: finalTie.id,
      leg: leg.leg,
      player_a: leg.playerA,
      player_b: leg.playerB,
      status: (leg.leg === 1 ? 'ready' : 'pending') as 'ready' | 'pending',
    }),
  );

  await admin.from('matches').insert(legs);
  await admin.from('tournaments').update({ status: 'final' }).eq('id', tournamentId);

  return finalTie.id;
}
