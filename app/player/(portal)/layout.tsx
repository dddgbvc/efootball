import { redirect } from 'next/navigation';
import { loadPlayerContext } from '@/lib/player/context';

export const dynamic = 'force-dynamic';

/**
 * The rules gate.
 *
 * Everything the tournament is actually about sits inside this group. The
 * rules screen and the profile screen sit outside it, which is what keeps the
 * redirect from pointing back at itself.
 */
export default async function GatedPlayerLayout({ children }: { children: React.ReactNode }) {
  const result = await loadPlayerContext();
  if (!result.ok) return <>{children}</>;

  if (!result.context.rules.accepted) redirect('/player/rules');

  return <>{children}</>;
}
