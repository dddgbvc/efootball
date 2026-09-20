import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

let cached: SupabaseClient<Database> | null = null;

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Every call site must have already established *who* the caller is and *that
 * they are allowed to do this* — see lib/permissions. It is imported with
 * `server-only`, so a client component that reaches for it fails to build
 * rather than shipping the key to a browser.
 */
export function createAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }

  if (!cached) {
    cached = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'efootball-server' } },
    });
  }

  return cached;
}
