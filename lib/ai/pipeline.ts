import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { crossVerify, type VerificationReason } from './crossVerify';
import { getVisionClient } from './vision';
import type { VisionExtraction } from './schema';
import { loadRules } from '@/lib/tournament/queries';
import { notifyTournamentAdmins } from '@/lib/telegram/notify';
import {
  aiUnavailableMessage,
  mismatchMessage,
  secondEvidenceMessage,
  verifiedMessage,
  championMessage,
} from '@/lib/telegram/messages';
import { classifyChampion, classifyVerifiedMatch } from '@/lib/news/classify';
import { publishOfficialEvent } from '@/lib/news/publish';
import { advanceAfterTie, materializeFinalLegs } from '@/lib/tournament/engine';
import type { AiExtractionRow, MatchEvidenceRow } from '@/types/database';

const MAX_AI_ATTEMPTS = 3;

export type PipelineOutcome =
  | { state: 'waiting_for_second_evidence' }
  | { state: 'already_official' }
  | { state: 'deferred'; reason: string; attempts: number }
  | { state: 'review_required'; reasons: VerificationReason[] }
  | { state: 'verified'; scoreA: number; scoreB: number };

/**
 * The dual-screenshot verification pipeline.
 *
 * Idempotent by construction: extractions are keyed on (evidence, attempt) and
 * the cross-verification run is keyed on the exact pair of evidence rows it
 * compared, so re-running after a crash, a retry or a duplicate request reaches
 * the same conclusion without double-applying anything.
 */
export async function processMatchVerification(matchId: string): Promise<PipelineOutcome> {
  const admin = createAdminClient();

  const { data: match } = await admin
    .from('matches')
    .select(
      'id, tournament_id, stage, tie_id, leg, round_number, player_a, player_b, status, score_a, score_b',
    )
    .eq('id', matchId)
    .maybeSingle();

  if (!match) throw new Error('MATCH_NOT_FOUND');
  if (match.status === 'verified' || match.status === 'completed') {
    return { state: 'already_official' };
  }

  const { data: evidenceRows } = await admin
    .from('match_evidence')
    .select('*')
    .eq('match_id', matchId)
    .is('superseded_at', null)
    .order('created_at', { ascending: true });

  const evidence = latestPerUploader(evidenceRows ?? []);
  const evidenceA = evidence.get(match.player_a);
  const evidenceB = evidence.get(match.player_b);

  if (!evidenceA || !evidenceB) {
    return { state: 'waiting_for_second_evidence' };
  }

  const [tournament, rules, profiles] = await Promise.all([
    admin
      .from('tournaments')
      .select('id, name, status, champion_id')
      .eq('id', match.tournament_id)
      .maybeSingle()
      .then((r) => r.data),
    loadRules(admin, match.tournament_id),
    admin
      .from('profiles')
      .select('id, display_name, efootball_name')
      .in('id', [match.player_a, match.player_b])
      .then((r) => r.data ?? []),
  ]);

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? id;
  const aliasesOf = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    return [p?.display_name, p?.efootball_name].filter((v): v is string => Boolean(v));
  };

  // Announce that both screenshots are in, once.
  await notifyTournamentAdmins(
    match.tournament_id,
    `evidence-complete:${evidenceA.id}:${evidenceB.id}`,
    secondEvidenceMessage({
      tournamentName: tournament?.name ?? '',
      tournamentId: match.tournament_id,
      matchId,
      playerA: nameOf(match.player_a),
      playerB: nameOf(match.player_b),
    }),
  );

  const resultA = await ensureExtraction(evidenceA, match.tournament_id, tournament?.name ?? '', {
    playerAName: nameOf(match.player_a),
    playerBName: nameOf(match.player_b),
  });
  const resultB = await ensureExtraction(evidenceB, match.tournament_id, tournament?.name ?? '', {
    playerAName: nameOf(match.player_a),
    playerBName: nameOf(match.player_b),
  });

  if (!resultA.ok || !resultB.ok) {
    const failure: Extract<ExtractionResult, { ok: false }> = resultA.ok
      ? (resultB as Extract<ExtractionResult, { ok: false }>)
      : resultA;
    const attempts = Math.max(resultA.attempt, resultB.attempt);

    if (failure.kind === 'unavailable' && attempts < MAX_AI_ATTEMPTS) {
      // Evidence is safely stored; the retry endpoint will pick this up.
      await admin
        .from('matches')
        .update({ status: 'awaiting_verification' })
        .eq('id', matchId)
        .not('status', 'in', '("verified","completed","cancelled")');

      return { state: 'deferred', reason: failure.detail, attempts };
    }

    await openCase(matchId, match.tournament_id, 'ai_unavailable', {
      detail: failure.detail,
      attempts,
    });

    await notifyTournamentAdmins(
      match.tournament_id,
      `ai-unavailable:${matchId}:${attempts}`,
      aiUnavailableMessage({
        tournamentId: match.tournament_id,
        matchId,
        playerA: nameOf(match.player_a),
        playerB: nameOf(match.player_b),
        detail: failure.detail,
      }),
    );

    return { state: 'review_required', reasons: [] };
  }

  const verdict = crossVerify(resultA.extraction, resultB.extraction, {
    minConfidence: rules.aiMinConfidence,
    statisticTolerance: rules.aiStatisticTolerance,
    expectedNames: {
      playerA: aliasesOf(match.player_a),
      playerB: aliasesOf(match.player_b),
    },
  });

  const idempotencyKey = `verify:${[evidenceA.id, evidenceB.id].sort().join(':')}`;

  const { error: runError } = await admin.from('verification_runs').insert({
    match_id: matchId,
    idempotency_key: idempotencyKey,
    extraction_a: resultA.extractionId,
    extraction_b: resultB.extractionId,
    outcome: verdict.outcome,
    reasons: verdict.reasons,
    agreed_score_a: verdict.agreedScore?.playerA ?? null,
    agreed_score_b: verdict.agreedScore?.playerB ?? null,
    detail: verdict.detail as never,
  });

  // This exact pair was already processed — do not apply anything twice.
  if (runError) {
    return verdict.outcome === 'verified'
      ? {
          state: 'verified',
          scoreA: verdict.agreedScore!.playerA,
          scoreB: verdict.agreedScore!.playerB,
        }
      : { state: 'review_required', reasons: verdict.reasons };
  }

  if (verdict.outcome === 'review_required') {
    await admin
      .from('matches')
      .update({ status: 'review_required' })
      .eq('id', matchId)
      .not('status', 'in', '("verified","completed","cancelled")');

    await openCase(matchId, match.tournament_id, primaryReason(verdict.reasons), {
      reasons: verdict.reasons,
      readings: verdict.detail,
    });

    await notifyTournamentAdmins(
      match.tournament_id,
      `mismatch:${idempotencyKey}`,
      mismatchMessage({
        tournamentId: match.tournament_id,
        matchId,
        playerA: nameOf(match.player_a),
        playerB: nameOf(match.player_b),
        readingA: `${resultA.extraction.score.playerA} - ${resultA.extraction.score.playerB}`,
        readingB: `${resultB.extraction.score.playerA} - ${resultB.extraction.score.playerB}`,
        reasons: verdict.reasons,
      }),
    );

    return { state: 'review_required', reasons: verdict.reasons };
  }

  const score = verdict.agreedScore!;

  await applyVerifiedResult({
    matchId,
    tournamentId: match.tournament_id,
    scoreA: score.playerA,
    scoreB: score.playerB,
    source: 'ai_verified',
    actorId: null,
    note: `AI cross-verified (${verdict.detail.statisticsCompared} إحصائية متطابقة)`,
    extraction: resultA.extraction,
  });

  return { state: 'verified', scoreA: score.playerA, scoreB: score.playerB };
}

/**
 * The single fan-out point after a result becomes official (§87).
 *
 * Standings, aggregates, advancement, Telegram, news and the group system
 * message all hang off one verified event and are each individually idempotent.
 */
export async function applyVerifiedResult(args: {
  matchId: string;
  tournamentId: string;
  scoreA: number;
  scoreB: number;
  source: 'ai_verified' | 'admin_override' | 'walkover';
  actorId: string | null;
  note: string | null;
  extraTimeA?: number | null;
  extraTimeB?: number | null;
  penaltiesA?: number | null;
  penaltiesB?: number | null;
  extraction?: VisionExtraction;
}) {
  const admin = createAdminClient();

  const { data: applied, error } = await admin.rpc('apply_official_result', {
    p_match_id: args.matchId,
    p_score_a: args.scoreA,
    p_score_b: args.scoreB,
    p_source: args.source,
    p_actor: args.actorId,
    p_note: args.note,
    p_extra_time_a: args.extraTimeA ?? null,
    p_extra_time_b: args.extraTimeB ?? null,
    p_penalties_a: args.penaltiesA ?? null,
    p_penalties_b: args.penaltiesB ?? null,
  });

  if (error) throw new Error(`APPLY_RESULT_FAILED: ${error.message}`);

  const outcome = applied as {
    ok: boolean;
    error?: string;
    tie_id?: string | null;
    tie_completed?: boolean;
    aggregate_a?: number;
    aggregate_b?: number;
  };

  if (!outcome.ok) throw new Error(outcome.error ?? 'APPLY_RESULT_REJECTED');

  const { data: match } = await admin
    .from('matches')
    .select('id, stage, leg, round_number, player_a, player_b, team_a, team_b, tie_id')
    .eq('id', args.matchId)
    .single();

  const { data: tournament } = await admin
    .from('tournaments')
    .select('id, name, status, champion_id')
    .eq('id', args.tournamentId)
    .single();

  // apply_official_result() already succeeded, so both rows exist. Fail loudly
  // rather than fanning out on partial state.
  if (!match || !tournament) throw new Error('OFFICIAL_RESULT_STATE_MISSING');

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, display_name')
    .in('id', [match.player_a, match.player_b]);

  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.display_name ?? id;
  const rules = await loadRules(admin, args.tournamentId);

  await admin.from('tournament_activity').insert({
    tournament_id: args.tournamentId,
    kind: 'result_verified',
    message: `تم اعتماد نتيجة ${nameOf(match.player_a)} × ${nameOf(match.player_b)}`,
    match_id: args.matchId,
  });

  await notifyTournamentAdmins(
    args.tournamentId,
    `verified:${args.matchId}:${args.scoreA}-${args.scoreB}`,
    verifiedMessage({
      tournamentId: args.tournamentId,
      matchId: args.matchId,
      playerA: nameOf(match.player_a),
      playerB: nameOf(match.player_b),
      scoreA: args.scoreA,
      scoreB: args.scoreB,
    }),
  );

  await admin.rpc('post_system_message', {
    p_tournament_id: args.tournamentId,
    p_body: `🏁 انتهت مباراة ${nameOf(match.player_a)} × ${nameOf(match.player_b)}\nالنتيجة الرسمية: ${args.scoreA}–${args.scoreB}`,
    p_event: `match_verified:${args.matchId}`,
  });

  for (const playerId of [match.player_a, match.player_b]) {
    await admin.from('notifications').insert({
      user_id: playerId,
      tournament_id: args.tournamentId,
      type: 'match_verified',
      title: 'تم توثيق نتيجة مباراتك',
      body: `${nameOf(match.player_a)} ${args.scoreA} – ${args.scoreB} ${nameOf(match.player_b)}`,
      link: `/match/${args.matchId}`,
      event_key: `match_verified:${args.matchId}`,
    });
  }

  const event = classifyVerifiedMatch(
    {
      matchId: args.matchId,
      tournamentName: tournament.name,
      stage: match.stage,
      roundNumber: match.round_number,
      leg: match.leg as 1 | 2,
      playerA: { id: match.player_a, name: nameOf(match.player_a), team: match.team_a },
      playerB: { id: match.player_b, name: nameOf(match.player_b), team: match.team_b },
      scoreA: args.scoreA,
      scoreB: args.scoreB,
      aggregateA: outcome.aggregate_a ?? null,
      aggregateB: outcome.aggregate_b ?? null,
      statistics: args.extraction
        ? Object.fromEntries(
            Object.entries(args.extraction.statistics).map(([k, v]) => [
              k,
              { playerA: v.playerA, playerB: v.playerB },
            ]),
          )
        : undefined,
      verified: true,
    },
    { bigWinGoalDiff: rules.bigWinGoalDiff },
  );

  await publishOfficialEvent(args.tournamentId, event, args.matchId);

  if (match.tie_id) {
    await advanceAfterTie(args.tournamentId, match.tie_id);
    await materializeFinalLegs(args.tournamentId);
  }

  const { data: after } = await admin
    .from('tournaments')
    .select('status, champion_id, name')
    .eq('id', args.tournamentId)
    .single();

  if (after && after.status === 'completed' && after.champion_id) {
    const championName = nameOf(after.champion_id);
    await notifyTournamentAdmins(
      args.tournamentId,
      `champion:${args.tournamentId}`,
      championMessage({
        tournamentName: after.name,
        tournamentId: args.tournamentId,
        champion: championName,
      }),
    );
    await publishOfficialEvent(
      args.tournamentId,
      classifyChampion(args.tournamentId, after.name, championName, null),
    );
    await admin.rpc('post_system_message', {
      p_tournament_id: args.tournamentId,
      p_body: `🏆 تُوّج ${championName} بطلاً لـ ${after.name}!`,
      p_event: 'champion',
    });
  }

  await snapshotStandings(args.tournamentId, match.round_number);

  return outcome;
}

async function snapshotStandings(tournamentId: string, roundNumber: number | null) {
  const admin = createAdminClient();
  const { loadStandings } = await import('@/lib/tournament/queries');
  const bundle = await loadStandings(admin, tournamentId);

  await admin.from('standings_snapshots').insert({
    tournament_id: tournamentId,
    round_number: roundNumber,
    table_state: bundle.standings as never,
    reason: 'match_verified',
  });
}

type ExtractionResult =
  | { ok: true; extraction: VisionExtraction; extractionId: string; attempt: number }
  | { ok: false; kind: 'unavailable' | 'invalid'; detail: string; attempt: number };

/**
 * Returns a usable extraction for a piece of evidence, reusing a previous
 * successful pass rather than paying for the model again.
 */
async function ensureExtraction(
  evidence: MatchEvidenceRow,
  tournamentId: string,
  tournamentName: string,
  hint: { playerAName: string; playerBName: string },
): Promise<ExtractionResult> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('ai_extractions')
    .select('*')
    .eq('evidence_id', evidence.id)
    .order('attempt', { ascending: false });

  const succeeded = (existing ?? []).find((e) => e.status === 'succeeded');
  if (succeeded) {
    return {
      ok: true,
      extraction: rehydrate(succeeded),
      extractionId: succeeded.id,
      attempt: succeeded.attempt,
    };
  }

  const attempt = ((existing ?? [])[0]?.attempt ?? 0) + 1;

  const client = getVisionClient();
  if (!client) {
    await recordFailure(evidence, tournamentId, attempt, 'failed', 'AI_API_KEY is not configured');
    return { ok: false, kind: 'unavailable', detail: 'AI_API_KEY is not configured', attempt };
  }

  const download = await admin.storage.from('match-evidence').download(evidence.storage_path);
  if (download.error || !download.data) {
    await recordFailure(
      evidence,
      tournamentId,
      attempt,
      'failed',
      download.error?.message ?? 'evidence download failed',
    );
    return {
      ok: false,
      kind: 'unavailable',
      detail: download.error?.message ?? 'evidence download failed',
      attempt,
    };
  }

  const base64 = Buffer.from(await download.data.arrayBuffer()).toString('base64');

  const outcome = await client.extract({
    imageBase64: base64,
    mediaType: evidence.mime_type as 'image/jpeg' | 'image/png' | 'image/webp',
    contextHint: { ...hint, tournamentName },
  });

  if (!outcome.ok) {
    await recordFailure(
      evidence,
      tournamentId,
      attempt,
      outcome.error === 'AI_UNAVAILABLE' ? 'failed' : 'invalid_output',
      outcome.detail,
    );
    return {
      ok: false,
      kind: outcome.error === 'AI_UNAVAILABLE' ? 'unavailable' : 'invalid',
      detail: outcome.detail,
      attempt,
    };
  }

  const e = outcome.extraction;
  const { data: row, error } = await admin
    .from('ai_extractions')
    .insert({
      match_id: evidence.match_id,
      evidence_id: evidence.id,
      provider: outcome.provider,
      model: outcome.model,
      status: 'succeeded',
      valid_result_screen: e.validResultScreen,
      player_a_name: e.playerA.name,
      player_b_name: e.playerB.name,
      team_a_name: e.playerA.team,
      team_b_name: e.playerB.team,
      team_a_logo_detected: e.playerA.logoDetected,
      team_b_logo_detected: e.playerB.logoDetected,
      score_a: e.score.playerA,
      score_b: e.score.playerB,
      statistics: e.statistics as never,
      confidence_overall: e.confidence.overall,
      confidence_score: e.confidence.score,
      confidence_identity: e.confidence.identity,
      confidence_stats: e.confidence.statistics,
      raw_response: outcome.raw as never,
      attempt,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`EXTRACTION_PERSIST_FAILED: ${error.message}`);

  return { ok: true, extraction: e, extractionId: row.id, attempt };
}

async function recordFailure(
  evidence: MatchEvidenceRow,
  _tournamentId: string,
  attempt: number,
  status: 'failed' | 'invalid_output',
  detail: string,
) {
  const admin = createAdminClient();
  await admin.from('ai_extractions').insert({
    match_id: evidence.match_id,
    evidence_id: evidence.id,
    provider: 'anthropic',
    model: 'claude-opus-5',
    status,
    error_message: detail.slice(0, 1000),
    attempt,
    completed_at: new Date().toISOString(),
  });
}

/** Rebuilds the validated extraction shape from a stored row. */
function rehydrate(row: AiExtractionRow): VisionExtraction {
  return {
    validResultScreen: row.valid_result_screen ?? false,
    game: 'eFootball',
    playerA: {
      name: row.player_a_name,
      team: row.team_a_name,
      logoDetected: row.team_a_logo_detected ?? false,
    },
    playerB: {
      name: row.player_b_name,
      team: row.team_b_name,
      logoDetected: row.team_b_logo_detected ?? false,
    },
    score: { playerA: row.score_a ?? 0, playerB: row.score_b ?? 0 },
    statistics: (row.statistics ?? {}) as VisionExtraction['statistics'],
    confidence: {
      overall: Number(row.confidence_overall ?? 0),
      score: Number(row.confidence_score ?? 0),
      identity: Number(row.confidence_identity ?? 0),
      statistics: Number(row.confidence_stats ?? 0),
    },
  };
}

function latestPerUploader(rows: MatchEvidenceRow[]): Map<string, MatchEvidenceRow> {
  const byUser = new Map<string, MatchEvidenceRow>();
  for (const row of rows) {
    const current = byUser.get(row.uploaded_by);
    if (!current || row.version > current.version) byUser.set(row.uploaded_by, row);
  }
  return byUser;
}

function primaryReason(reasons: VerificationReason[]) {
  const priority: VerificationReason[] = [
    'invalid_result_screen',
    'identity_mismatch',
    'team_mismatch',
    'score_mismatch',
    'statistics_mismatch',
    'unreadable_evidence',
    'low_confidence',
  ];
  return priority.find((r) => reasons.includes(r)) ?? 'low_confidence';
}

async function openCase(
  matchId: string,
  tournamentId: string,
  reason: string,
  detail: Record<string, unknown>,
) {
  const admin = createAdminClient();
  await admin.from('verification_cases').insert({
    tournament_id: tournamentId,
    match_id: matchId,
    reason: reason as never,
    detail: detail as never,
  });
}
