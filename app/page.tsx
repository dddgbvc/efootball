import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { STATUS_LABELS_AR } from '@/lib/tournament/lifecycle';
import type { TournamentStatus } from '@/lib/tournament/types';

export const revalidate = 30;

interface PublicTournament {
  id: string;
  slug: string;
  name: string;
  status: TournamentStatus;
  capacity: number;
  player_count: number;
  accent_color: string;
}

const STEPS: Array<[title: string, body: string]> = [
  ['كل لاعب يرسل صورته', 'صورة شاشة النتيجة من كل طرف، تُحفظ كما وصلت ولا تُعدَّل بعدها.'],
  ['القراءة الآلية للشاشة', 'الأسماء، الفرق، الشعارات، النتيجة وكل رقم في شاشة الإحصائيات.'],
  ['مقارنة الصورتين', 'تطابق النتيجة وحده لا يكفي — الهوية والفرق والإحصائيات كذلك.'],
  ['المسؤول يحسم الشك', 'أي اختلاف يفتح قضية مراجعة، ولا يتحرك الترتيب قبل القرار.'],
];

export default async function HomePage() {
  let tournaments: PublicTournament[] = [];
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
    tournaments = (data ?? []) as PublicTournament[];
  } catch {
    configured = false;
  }

  const openSeats = tournaments.reduce((sum, t) => sum + (t.capacity - t.player_count), 0);

  return (
    <div className="shell" style={{ paddingBlockEnd: 96 }}>
      <section className="hero">
        <div data-stagger>
          <div className="eyebrow">منصة بطولات eFootball</div>
          <h1 className="hero-title">
            بطولة تُدار مثل
            <br />
            <span style={{ color: 'var(--accent)' }}>غرفة عمليات مباراة</span>
          </h1>
          <p className="hero-lede">
            دوري ذهاب وإياب، تصفيات بقرعة رسمية، وتوثيق نتائج يقوم على صورتين من الطرفين — لا على
            كلمة أحدهما. القرار النهائي يبقى بيد المسؤول، ومسجَّلاً في سجل لا يُمحى.
          </p>

          <div style={{ display: 'flex', gap: 12, marginBlockStart: 30, flexWrap: 'wrap' }}>
            <Link href="/admin/tournaments/new" className="btn btn-primary">
              أنشئ بطولة
            </Link>
            <Link href="/tournaments" className="btn">
              تصفح البطولات
            </Link>
          </div>
        </div>

        {/* The motif is a real score strip, built from the same primitives the
            live match page uses — the product itself, not a drawing of it. */}
        <div className="scorecard animate-rise" aria-hidden>
          <div className="scorecard-row">
            <div className="scorecard-side">
              <div className="eyebrow" style={{ marginBlockEnd: 4 }}>
                المضيف
              </div>
              منتخب الأرجنتين
            </div>
            <div className="scorecard-score">
              <span>2</span>
              <span className="sep">:</span>
              <span>1</span>
            </div>
            <div className="scorecard-side" style={{ textAlign: 'end' }}>
              <div className="eyebrow" style={{ marginBlockEnd: 4 }}>
                الضيف
              </div>
              مانشستر سيتي
            </div>
          </div>
          <div className="scorecard-foot">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span className="pulse-dot" />
              موثّقة بصورتين
            </span>
            <span className="numeric">الجولة 07 · ذهاب</span>
          </div>
        </div>
      </section>

      <section className="figure-strip">
        {(
          [
            ['بطولات معروضة', String(tournaments.length)],
            ['مقاعد شاغرة', String(openSeats)],
            ['سعة البطولة', '8 أو 16'],
            ['صور لكل نتيجة', '2'],
          ] as Array<[string, string]>
        ).map(([label, value]) => (
          <div key={label} className="figure-cell">
            <div className="eyebrow">{label}</div>
            <div className="figure-value">{value}</div>
          </div>
        ))}
      </section>

      <section className="strip" style={{ marginBlockStart: 72 }}>
        <div className="section-head">
          <h2>بطولات عامة</h2>
          <Link href="/tournaments" className="site-nav-link" style={{ fontSize: 14 }}>
            عرض الكل ←
          </Link>
        </div>

        {!configured ? (
          <div className="panel" style={{ padding: 24, color: 'var(--text-muted)' }}>
            لم يتم ربط قاعدة البيانات بعد. راجع ملف <code>.env.example</code> و README.
          </div>
        ) : tournaments.length === 0 ? (
          <div className="panel" style={{ padding: '56px 24px', textAlign: 'center' }}>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>
              لا توجد بطولة عامة معروضة الآن.
            </p>
            <Link
              href="/admin/tournaments/new"
              className="btn btn-primary"
              style={{ marginBlockStart: 18 }}
            >
              كن أول من ينشئ واحدة
            </Link>
          </div>
        ) : (
          <ul
            data-stagger
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            {tournaments.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tournaments/${t.slug}`}
                  className="panel card-link"
                  style={{ padding: 20 }}
                >
                  <span
                    aria-hidden
                    className="rule"
                    style={{ background: t.accent_color, marginBlockEnd: 16 }}
                  />
                  <h3 style={{ fontSize: 19, marginBlockEnd: 12, letterSpacing: '-0.02em' }}>
                    {t.name}
                  </h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="tag">{STATUS_LABELS_AR[t.status]}</span>
                    <span className="tag numeric">
                      {t.player_count} / {t.capacity}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="strip" style={{ marginBlockStart: 72 }}>
        <div className="section-head">
          <h2>كيف تُوثَّق كل نتيجة</h2>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>أربع خطوات، بلا استثناء</span>
        </div>

        <ol className="step-rail" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {STEPS.map(([title, body], i) => (
            <li key={title} className="step-cell">
              <div className="step-index">{String(i + 1).padStart(2, '0')}</div>
              <h3 style={{ fontSize: 16, marginBlock: '10px 8px' }}>{title}</h3>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
