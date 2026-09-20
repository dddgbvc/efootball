import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';

export const revalidate = 30;

export default async function HomePage() {
  let tournaments: Array<{
    id: string;
    slug: string;
    name: string;
    status: TournamentStatus;
    capacity: number;
    player_count: number;
    accent_color: string;
  }> = [];
  let configured = true;

  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase
      .from('tournaments')
      .select('id, slug, name, status, capacity, player_count, accent_color')
      .eq('visibility', 'public')
      .neq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(6);
    tournaments = (data ?? []) as typeof tournaments;
  } catch {
    configured = false;
  }

  return (
    <div className="shell" style={{ paddingBlock: '48px 80px' }}>
      <section
        style={{
          display: 'grid',
          gap: 40,
          gridTemplateColumns: 'minmax(0, 1fr)',
          alignItems: 'end',
        }}
      >
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow">منصة بطولات eFootball</div>
          <h1
            style={{
              fontSize: 'clamp(2.4rem, 7vw, 4.4rem)',
              lineHeight: 1.05,
              marginBlock: '14px 18px',
              letterSpacing: '-0.035em',
            }}
          >
            بطولة تُدار مثل
            <br />
            <span style={{ color: 'var(--accent)' }}>غرفة عمليات مباراة</span>
          </h1>
          <p style={{ fontSize: 17, color: 'var(--text-muted)', maxWidth: 560 }}>
            دوري ذهاب وإياب، تصفيات بقرعة رسمية، وتوثيق نتائج يعتمد على صورتين من الطرفين
            يتحقق منهما الذكاء الاصطناعي — والقرار النهائي دائماً للمسؤول.
          </p>

          <div style={{ display: 'flex', gap: 12, marginBlockStart: 28, flexWrap: 'wrap' }}>
            <Link href="/tournaments" className="btn btn-primary">
              تصفح البطولات
            </Link>
            <Link href="/admin/tournaments/new" className="btn">
              أنشئ بطولة
            </Link>
          </div>
        </div>
      </section>

      <section className="strip" style={{ marginBlockStart: 64 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
            marginBlockEnd: 18,
          }}
        >
          <h2 style={{ fontSize: 22 }}>بطولات عامة</h2>
          <Link href="/tournaments" style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            عرض الكل ←
          </Link>
        </div>

        {!configured ? (
          <div className="panel" style={{ padding: 24, color: 'var(--text-muted)' }}>
            لم يتم ربط قاعدة البيانات بعد. راجع ملف <code>.env.example</code> و README.
          </div>
        ) : tournaments.length === 0 ? (
          <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            لا توجد بطولات عامة حالياً.
          </div>
        ) : (
          <ul
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            {tournaments.map((t) => (
              <li key={t.id} className="panel animate-rise" style={{ padding: 18 }}>
                <div
                  aria-hidden
                  style={{ height: 3, background: t.accent_color, marginBlockEnd: 14, width: 52 }}
                />
                <Link href={`/tournaments/${t.slug}`} style={{ display: 'block' }}>
                  <h3 style={{ fontSize: 18, marginBlockEnd: 8 }}>{t.name}</h3>
                </Link>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className="tag">{STATUS_LABELS_AR[t.status]}</span>
                  <span className="tag numeric">
                    {t.player_count} / {t.capacity}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="strip" style={{ marginBlockStart: 64 }}>
        <h2 style={{ fontSize: 22, marginBlockEnd: 18 }}>كيف يعمل التوثيق</h2>
        <ol
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            listStyle: 'none',
            margin: 0,
            padding: 0,
            counterReset: 'step',
          }}
        >
          {[
            ['كل لاعب يرسل صورته', 'صورة شاشة النتيجة من كل طرف، تُحفظ ولا تُعدّل.'],
            ['الذكاء الاصطناعي يقرأ الشاشة كاملة', 'الأسماء، الفرق، الشعارات، النتيجة وكل الإحصائيات.'],
            ['مقارنة الصورتين', 'تطابق النتيجة وحده لا يكفي — الهوية والفرق والإحصائيات أيضاً.'],
            ['المسؤول يحسم الشك', 'أي اختلاف يفتح قضية مراجعة ولا يغيّر الترتيب.'],
          ].map(([title, body], i) => (
            <li key={title} className="panel" style={{ padding: 18 }}>
              <div className="numeric eyebrow" style={{ color: 'var(--accent)' }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <h3 style={{ fontSize: 16, marginBlock: '8px 6px' }}>{title}</h3>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
