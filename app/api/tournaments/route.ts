import { createServerSupabase } from '@/lib/supabase/server';
import { requireAuthenticated } from '@/lib/permissions';
import { createTournamentSchema } from '@/lib/validation/schemas';
import { rulesForPreset, getPreset } from '@/lib/tournament/presets';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticated();

    const limit = rateLimit(`create-tournament:${user.id}`, 10, 60 * 60 * 1000);
    if (!limit.allowed) return fail('RATE_LIMITED', 'تجاوزت الحد المسموح، حاول لاحقاً', 429);

    const input = await parseBody(request, createTournamentSchema);

    const preset = getPreset(input.preset);
    if (!preset.productionReady) {
      return fail('PRESET_NOT_AVAILABLE', 'هذا النظام غير متاح للاستخدام بعد', 422);
    }
    if (!preset.capacities.includes(input.capacity)) {
      return fail(
        'CAPACITY_NOT_SUPPORTED',
        `النظام المختار لا يدعم ${input.capacity} لاعبين`,
        422,
      );
    }

    // Create the caller's own tournament under the caller session. RLS remains
    // the authority; no service-role key is required for this operation.
    const supabase = await createServerSupabase();

    const { data: tournament, error } = await supabase
      .from('tournaments')
      .insert({
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        accent_color: input.accentColor,
        capacity: input.capacity,
        preset: input.preset,
        visibility: input.visibility,
        platform: input.platform ?? null,
        prize_info: input.prizeInfo ?? null,
        allowed_teams: input.allowedTeams ?? null,
        auto_approve: input.autoApprove,
        waitlist_enabled: input.waitlistEnabled,
        ai_news_enabled: input.aiNewsEnabled,
        ai_news_mode: input.aiNewsMode,
        telegram_enabled: input.telegramEnabled,
        registration_opens_at: input.registrationOpensAt ?? null,
        registration_closes_at: input.registrationClosesAt ?? null,
        check_in_opens_at: input.checkInOpensAt ?? null,
        check_in_closes_at: input.checkInClosesAt ?? null,
        starts_at: input.startsAt ?? null,
        created_by: user.id,
        status: 'draft',
      })
      .select('id, slug')
      .single();

    if (error) {
      if (error.code === '23505') {
        return fail('SLUG_TAKEN', 'هذا الرابط مستخدم بالفعل', 409);
      }
      throw new Error(`TOURNAMENT_INSERT_FAILED: ${error.message}`);
    }

    // The bootstrap trigger created the rule row with defaults; layer the
    // preset and then the admin's overrides on top of it.
    const presetRules = rulesForPreset(input.preset);
    const overrides = input.rules ?? {};

    const { error: rulesError } = await supabase
      .from('tournament_rules')
      .update({
        match_duration_minutes: overrides.matchDurationMinutes ?? presetRules.matchDurationMinutes,
        league_enabled: presetRules.leagueEnabled,
        league_double_round: overrides.leagueDoubleRound ?? presetRules.leagueDoubleRound,
        league_extra_time: presetRules.leagueExtraTime,
        league_penalties: presetRules.leaguePenalties,
        points_win: overrides.pointsWin ?? presetRules.pointsWin,
        points_draw: overrides.pointsDraw ?? presetRules.pointsDraw,
        points_loss: overrides.pointsLoss ?? presetRules.pointsLoss,
        tiebreakers: overrides.tiebreakers ?? presetRules.tiebreakers,
        direct_semifinal_slots:
          overrides.directSemifinalSlots ?? presetRules.directSemifinalSlots,
        playoff_slots: overrides.playoffSlots ?? presetRules.playoffSlots,
        knockout_two_legs: overrides.knockoutTwoLegs ?? presetRules.knockoutTwoLegs,
        knockout_extra_time: overrides.knockoutExtraTime ?? presetRules.knockoutExtraTime,
        knockout_penalties: overrides.knockoutPenalties ?? presetRules.knockoutPenalties,
        away_goals_rule: overrides.awayGoalsRule ?? presetRules.awayGoalsRule,
        semifinal_draw_mode: overrides.semifinalDrawMode ?? presetRules.semifinalDrawMode,
        third_place_match: overrides.thirdPlaceMatch ?? presetRules.thirdPlaceMatch,
        big_win_goal_diff: overrides.bigWinGoalDiff ?? presetRules.bigWinGoalDiff,
      })
      .eq('tournament_id', tournament.id);

    if (rulesError) {
      // Keep creation all-or-nothing from the user's perspective. Draft owners
      // are allowed to delete their own tournament under RLS.
      await supabase.from('tournaments').delete().eq('id', tournament.id);
      throw new Error(`TOURNAMENT_RULES_UPDATE_FAILED: ${rulesError.message}`);
    }

    const fallbackHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ??
      (fallbackHost ? `https://${fallbackHost}` : new URL(request.url).origin)
    ).replace(/\/$/, '');

    return ok(
      {
        tournamentId: tournament.id,
        slug: tournament.slug,
        tournamentUrl: `${baseUrl}/tournaments/${encodeURIComponent(tournament.slug)}`,
      },
      201,
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
