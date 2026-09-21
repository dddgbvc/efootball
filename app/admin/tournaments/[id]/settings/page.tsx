import { createServerSupabase } from '@/lib/supabase/server';
import { loadRules } from '@/lib/tournament/queries';
import { RulesSheet } from '@/components/RulesSheet';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Read as the signed-in admin. Every table below is gated by an RLS policy
  // on app.is_tournament_admin(), so this page needs no service-role secret —
  // and cannot read past what this particular admin is entitled to see.
  const admin = await createServerSupabase();

  const [{ data: tournament }, rules] = await Promise.all([
    admin.from('tournaments').select('*').eq('id', id).maybeSingle(),
    loadRules(admin, id),
  ]);

  if (!tournament) return null;

  const facts: Array<[string, string]> = [
    ['الرابط', `/tournaments/${tournament.slug}`],
    ['الظهور', tournament.visibility === 'public' ? 'عامة' : 'خاصة — بالكود فقط'],
    ['قائمة الانتظار', tournament.waitlist_enabled ? 'مفعّلة' : 'معطّلة'],
    ['المراسل الآلي', tournament.ai_news_enabled ? 'مفعّل' : 'معطّل'],
    [
      'وضع نشر الأخبار',
      tournament.ai_news_mode === 'automatic' ? 'تلقائي' : 'مراجعة أولاً',
    ],
    ['تنبيهات Telegram', tournament.telegram_enabled ? 'مفعّلة' : 'معطّلة'],
    ['القوانين البنيوية', tournament.rules_locked ? 'مقفلة (توجد مباريات رسمية)' : 'قابلة للتعديل'],
  ];

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section className="panel">
        <dl style={{ margin: 0 }}>
          {facts.map(([term, value], index) => (
            <div
              key={term}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(150px, 260px) 1fr',
                gap: 16,
                padding: '13px 18px',
                borderBottom: index === facts.length - 1 ? 'none' : '1px solid var(--line)',
              }}
            >
              <dt style={{ color: 'var(--text-muted)', fontSize: 14 }}>{term}</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="strip">
        <h2 style={{ fontSize: 18, marginBlockEnd: 12 }}>القوانين السارية</h2>
        <RulesSheet rules={rules} capacity={tournament.capacity} />
        {tournament.rules_locked ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBlockStart: 10 }}>
            القوانين البنيوية مقفلة لأن مباريات رسمية أُنشئت بالفعل. أي محاولة لتغييرها
            تُرفض على مستوى قاعدة البيانات.
          </p>
        ) : null}
      </section>
    </div>
  );
}
