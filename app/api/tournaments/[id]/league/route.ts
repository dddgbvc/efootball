import { requireTournamentAdmin } from '@/lib/permissions';
import { generateLeagueSchedule } from '@/lib/tournament/engine';
import { handleRouteError, ok } from '@/lib/api/respond';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireTournamentAdmin(id);
    const result = await generateLeagueSchedule(id, user.id);
    return ok(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
