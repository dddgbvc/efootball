import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireAuthenticated } from '@/lib/permissions';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';

export const runtime = 'nodejs';

const schema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  }),
});

/**
 * Registers a device for push.
 *
 * The row is written under the caller's own session, so the policy — which
 * requires user_id to be the caller — is what binds the endpoint to the
 * account. The handler never takes a user id from the request body, because a
 * body field is not an identity.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuthenticated();
    const input = await parseBody(request, schema);

    const supabase = await createServerSupabase();
    const now = new Date().toISOString();

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth_secret: input.keys.auth,
        user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
        last_seen_at: now,
        failed_at: null,
      },
      { onConflict: 'endpoint' },
    );

    if (error) {
      // The unique key is the endpoint. A conflict the policy refuses means
      // the endpoint already belongs to somebody else's account.
      return fail('FORBIDDEN', 'تعذر تسجيل هذا الجهاز', 403);
    }

    return ok({ subscribed: true }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAuthenticated();
    const input = await parseBody(request, z.object({ endpoint: z.string().url().max(1000) }));

    const supabase = await createServerSupabase();
    await supabase.from('push_subscriptions').delete().eq('endpoint', input.endpoint);

    return ok({ subscribed: false });
  } catch (error) {
    return handleRouteError(error);
  }
}
