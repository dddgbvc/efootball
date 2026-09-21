import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadPlayerContext } from '@/lib/player/context';
import { loadRules } from '@/lib/tournament/queries';
import { RulesSheet } from '@/components/RulesSheet';
import { RuleDecision } from '@/components/player/RuleDecision';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'قوانين البطولة' };

export default async function PlayerRulesPage() {
  const result = await loadPlayerContext();
  if (!result.ok) redirect('/player');

  const { context } = result;
  const supabase = await createServerSupabase();
  const rules = await loadRules(supabase, context.tournament.id);

  const { data: rulesRow } = await supabase
    .from('tournament_rules')
    .select('custom_text, version')
    .eq('tournament_id', context.tournament.id)
    .maybeSingle();

  const decided = context.rules.decision !== null;
  const declined = context.rules.decision === false;
  const reAccept = !decided && context.rules.version > 1;

  return (
    <div className="player-page">
      <div className="eyebrow">الخطوة قبل اللعب</div>
      <h1 style={{ fontSize: 26, marginBlock: '8px 6px' }}>قوانين البطولة</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px' }}>
        {reAccept
          ? 'تم تحديث قوانين البطولة. يجب مراجعة النسخة الجديدة والموافقة عليها قبل متابعة اللعب.'
          : 'اقرأ القوانين كاملة قبل تأكيد مشاركتك.'}
      </p>

      {declined ? (
        <div
          role="status"
          className="panel"
          style={{
            padding: 20,
            marginBlockEnd: 20,
            borderColor: 'var(--color-alert-500)',
          }}
        >
          <strong style={{ color: 'var(--color-alert-400)' }}>لم تقبل قوانين البطولة</strong>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
            لا يمكنك المشاركة في البطولة قبل الموافقة على القوانين. يمكنك مراجعتها والموافقة
            في أي وقت.
          </p>
        </div>
      ) : null}

      {rulesRow?.custom_text ? (
        <section className="panel" style={{ padding: 20, marginBlockEnd: 16 }}>
          <div className="eyebrow" style={{ marginBlockEnd: 10 }}>
            من المنظّم
          </div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.85 }}>
            {rulesRow.custom_text}
          </p>
        </section>
      ) : null}

      <RulesSheet rules={rules} capacity={context.tournament.capacity} />

      <RuleDecision
        tournamentId={context.tournament.id}
        rulesVersion={context.rules.version}
        alreadyAccepted={context.rules.accepted}
      />
    </div>
  );
}
