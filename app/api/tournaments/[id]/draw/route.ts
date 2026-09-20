import { z } from 'zod';
import { requireTournamentAdmin } from '@/lib/permissions';
import { executePlayoffDraw, executeSemifinalDraw } from '@/lib/tournament/engine';
import { handleRouteError, ok, parseBody } from '@/lib/api/respond';

export const runtime = 'nodejs';
export const maxDuration = 60;

const schema = z.object({ kind: z.enum(['playoff', 'semifinal']) });

/**
 * Official randomisation happens here, on the server, with a CSPRNG.
 *
 * The client receives the persisted pairings only after they are written; it
 * never contributes entropy and cannot re-roll (the unique index on
 * draws(tournament_id, kind) rejects a second execution).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const user = await requireTournamentAdmin(id);
    const { kind } = await parseBody(request, schema);

    const result =
      kind === 'playoff'
        ? await executePlayoffDraw(id, user.id)
        : await executeSemifinalDraw(id, user.id);

    return ok({ kind, ...result }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
