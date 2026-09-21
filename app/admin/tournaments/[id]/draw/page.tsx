import { createServerSupabase } from '@/lib/supabase/server';
import { loadStandings } from '@/lib/tournament/queries';
import { BracketView } from '@/components/BracketView';
import { DrawReveal } from '@/components/DrawReveal';

export const dynamic = 'force-dynamic';

export default async function AdminDrawPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Read as the signed-in admin. Every table below is gated by an RLS policy
  // on app.is_tournament_admin(), so this page needs no service-role secret —
  // and cannot read past what this particular admin is entitled to see.
  const admin = await createServerSupabase();

  const [{ data: tournament }, bundle, { data: draws }] = await Promise.all([
    admin.from('tournaments').select('status').eq('id', id).maybeSingle(),
    loadStandings(admin, id),
    admin.from('draws').select('kind').eq('tournament_id', id),
  ]);

  const done = new Set((draws ?? []).map((d) => d.kind));
  const leagueComplete =
    bundle.totalMatches > 0 && bundle.verifiedMatches === bundle.totalMatches;

  const potNames = bundle.qualification.playoff.map(
    (pid) => bundle.playersById.get(pid)?.display_name ?? pid,
  );

  return (
    <div style={{ display: 'grid', gap: 26 }}>
      <section className="panel strip" style={{ padding: '18px 20px 22px' }}>
        <div className="eyebrow" style={{ marginBlockEnd: 10 }}>
          حالة القرعة
        </div>
        <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 14, color: 'var(--text-muted)' }}>
          <li>
            مباريات الدوري الموثقة: {bundle.verifiedMatches} / {bundle.totalMatches}
          </li>
          <li>قرعة التصفيات: {done.has('playoff') ? 'أُجريت' : 'لم تُجرَ'}</li>
          <li>قرعة نصف النهائي: {done.has('semifinal') ? 'أُجريت' : 'لم تُجرَ'}</li>
          {bundle.qualification.unresolvedTies.length > 0 ? (
            <li style={{ color: 'var(--color-alert-400)' }}>
              يوجد تعادل غير محسوم في الترتيب — يجب حسمه قبل القرعة.
            </li>
          ) : null}
        </ul>
      </section>

      {leagueComplete && !done.has('playoff') ? (
        <DrawReveal tournamentId={id} kind="playoff" pot={potNames} />
      ) : null}

      {tournament?.status === 'playoffs' && !done.has('semifinal') ? (
        <DrawReveal tournamentId={id} kind="semifinal" pot={[]} />
      ) : null}

      <BracketView tournamentId={id} showDraw />
    </div>
  );
}
