'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface PresetView {
  id: string;
  nameAr: string;
  descriptionAr: string;
  capacities: number[];
  productionReady: boolean;
}

const STEPS = [
  '01 الهوية',
  '02 المشاركون',
  '03 نظام البطولة',
  '04 قوانين المباريات',
  '05 التسجيل',
  '06 Telegram',
  '07 المراجعة والنشر',
] as const;

const TIEBREAKER_OPTIONS = [
  ['points', 'النقاط'],
  ['goal_difference', 'فارق الأهداف'],
  ['goals_for', 'الأهداف المسجلة'],
  ['head_to_head', 'المواجهة المباشرة'],
  ['goals_against', 'الأهداف المستقبَلة'],
  ['wins', 'عدد الانتصارات'],
] as const;

export function CreateTournamentWizard({ presets, appUrl }: { presets: PresetView[]; appUrl: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    accentColor: '#E8FF59',
    capacity: 8,
    preset: 'league8_double_playoffs',
    visibility: 'invite_only' as 'public' | 'invite_only',
    platform: '' as string,
    prizeInfo: '',
    waitlistEnabled: false,
    aiNewsEnabled: true,
    aiNewsMode: 'review_first' as 'review_first' | 'automatic',
    telegramEnabled: false,
    registrationOpensAt: '',
    registrationClosesAt: '',
    checkInOpensAt: '',
    checkInClosesAt: '',
    startsAt: '',
    matchDurationMinutes: 15,
    leagueDoubleRound: true,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    tiebreakers: ['points', 'goal_difference', 'goals_for', 'head_to_head'] as string[],
    directSemifinalSlots: 2,
    playoffSlots: 4,
    knockoutTwoLegs: true,
    knockoutExtraTime: true,
    knockoutPenalties: true,
    awayGoalsRule: false,
    semifinalDrawMode: 'seeded' as 'seeded' | 'open_draw',
    bigWinGoalDiff: 4,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const availablePresets = useMemo(
    () => presets.filter((p) => p.capacities.includes(form.capacity)),
    [presets, form.capacity],
  );

  const stepValid = useMemo(() => {
    switch (step) {
      case 0:
        return form.name.trim().length >= 3 && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(form.slug);
      case 2: {
        const preset = presets.find((p) => p.id === form.preset);
        return Boolean(preset?.productionReady && preset.capacities.includes(form.capacity));
      }
      case 3:
        return form.tiebreakers.length > 0 && form.directSemifinalSlots + form.playoffSlots <= form.capacity;
      default:
        return true;
    }
  }, [step, form, presets]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          slug: form.slug.trim(),
          description: form.description.trim() || null,
          accentColor: form.accentColor,
          capacity: form.capacity,
          preset: form.preset,
          visibility: form.visibility,
          platform: form.platform || null,
          prizeInfo: form.prizeInfo.trim() || null,
          waitlistEnabled: form.waitlistEnabled,
          aiNewsEnabled: form.aiNewsEnabled,
          aiNewsMode: form.aiNewsMode,
          telegramEnabled: form.telegramEnabled,
          registrationOpensAt: toIso(form.registrationOpensAt),
          registrationClosesAt: toIso(form.registrationClosesAt),
          checkInOpensAt: toIso(form.checkInOpensAt),
          checkInClosesAt: toIso(form.checkInClosesAt),
          startsAt: toIso(form.startsAt),
          rules: {
            matchDurationMinutes: form.matchDurationMinutes,
            leagueDoubleRound: form.leagueDoubleRound,
            pointsWin: form.pointsWin,
            pointsDraw: form.pointsDraw,
            pointsLoss: form.pointsLoss,
            tiebreakers: form.tiebreakers,
            directSemifinalSlots: form.directSemifinalSlots,
            playoffSlots: form.playoffSlots,
            knockoutTwoLegs: form.knockoutTwoLegs,
            knockoutExtraTime: form.knockoutExtraTime,
            knockoutPenalties: form.knockoutPenalties,
            awayGoalsRule: form.awayGoalsRule,
            semifinalDrawMode: form.semifinalDrawMode,
            bigWinGoalDiff: form.bigWinGoalDiff,
          },
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        tournamentId?: string;
        slug?: string;
        tournamentUrl?: string;
        message?: string;
      };

      if (!payload.ok || !payload.tournamentId) {
        setError(payload.message ?? 'تعذر إنشاء البطولة');
        return;
      }

      router.push(`/admin/tournaments/${payload.tournamentId}`);
      router.refresh();
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ol
        style={{
          display: 'flex',
          gap: 0,
          overflowX: 'auto',
          listStyle: 'none',
          margin: '0 0 24px',
          padding: 0,
          borderBottom: '1px solid var(--line)',
        }}
      >
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => index <= step && setStep(index)}
              aria-current={index === step ? 'step' : undefined}
              disabled={index > step}
              style={{
                background: 'none',
                border: 'none',
                padding: '10px 14px',
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: index === step ? 700 : 500,
                color: index === step ? 'var(--text)' : 'var(--text-muted)',
                borderBottom: `2px solid ${index === step ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1,
                cursor: index <= step ? 'pointer' : 'default',
              }}
            >
              {label}
            </button>
          </li>
        ))}
      </ol>

      <div className="panel strip" style={{ padding: '20px 22px 24px' }}>
        {step === 0 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <Text
              label="اسم البطولة"
              value={form.name}
              onChange={(v) => {
                set('name', v);
                if (!form.slug) set('slug', slugify(v));
              }}
            />
            <Text
              label="الرابط (إنجليزي، حروف صغيرة وشرطات)"
              value={form.slug}
              onChange={(v) => set('slug', slugify(v))}
              ltr
            />
            {/* The address of the public page, which is not how anyone joins:
                players enter a code the organiser sends them. Saying so here
                stops this from being copied and sent as an invitation, which
                lands on a 404 for every tournament that is still a draft or
                invite-only. */}
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span>صفحة البطولة العامة:</span>{' '}
              <span dir="ltr" style={{ overflowWrap: 'anywhere' }}>
                {fullTournamentUrl(appUrl, form.slug || 'your-tournament')}
              </span>
              <div style={{ marginBlockStart: 4 }}>
                الانضمام لا يتم عبر هذا الرابط — بعد الإنشاء يظهر لك كود البطولة لترسله للاعبين.
              </div>
            </div>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={labelStyle}>الوصف</span>
              <textarea
                className="field"
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={labelStyle}>اللون المميز</span>
              <input
                type="color"
                className="field"
                style={{ padding: 4, height: 48 }}
                value={form.accentColor}
                onChange={(e) => set('accentColor', e.target.value.toUpperCase())}
              />
            </label>
          </div>
        ) : null}

        {step === 1 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={labelStyle}>عدد المشاركين</legend>
              <div style={{ display: 'flex', gap: 10, marginBlockStart: 8 }}>
                {[8, 16].map((capacity) => (
                  <button
                    key={capacity}
                    type="button"
                    className={form.capacity === capacity ? 'btn btn-primary' : 'btn'}
                    onClick={() => {
                      set('capacity', capacity);
                      const first = presets.find(
                        (p) => p.productionReady && p.capacities.includes(capacity),
                      );
                      if (first) set('preset', first.id);
                      set('directSemifinalSlots', capacity === 8 ? 2 : 4);
                      set('playoffSlots', capacity === 8 ? 4 : 8);
                    }}
                  >
                    {capacity} لاعب
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBlockEnd: 0 }}>
                هذا حد صارم يُفرض على مستوى قاعدة البيانات — لن يُقبل لاعب إضافي مهما حدث.
              </p>
            </fieldset>

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={labelStyle}>المنصة</span>
              <select
                className="field"
                value={form.platform}
                onChange={(e) => set('platform', e.target.value)}
              >
                <option value="">—</option>
                <option value="ps5">PlayStation 5</option>
                <option value="ps4">PlayStation 4</option>
                <option value="xbox">Xbox</option>
                <option value="pc">PC</option>
                <option value="mobile">موبايل</option>
                <option value="other">أخرى</option>
              </select>
            </label>

            <Text
              label="معلومات الجائزة"
              value={form.prizeInfo}
              onChange={(v) => set('prizeInfo', v)}
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {availablePresets.map((preset) => (
              <label
                key={preset.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: 14,
                  border: `1px solid ${form.preset === preset.id ? 'var(--accent)' : 'var(--line)'}`,
                  cursor: preset.productionReady ? 'pointer' : 'not-allowed',
                  opacity: preset.productionReady ? 1 : 0.5,
                }}
              >
                <input
                  type="radio"
                  name="preset"
                  value={preset.id}
                  checked={form.preset === preset.id}
                  disabled={!preset.productionReady}
                  onChange={() => set('preset', preset.id)}
                  style={{ marginBlockStart: 4 }}
                />
                <span>
                  <strong>{preset.nameAr}</strong>
                  {!preset.productionReady ? (
                    <span className="tag" style={{ marginInlineStart: 8 }}>
                      غير متاح بعد
                    </span>
                  ) : null}
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13,
                      color: 'var(--text-muted)',
                      marginBlockStart: 4,
                    }}
                  >
                    {preset.descriptionAr}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <NumberField
              label="مدة المباراة (دقائق)"
              value={form.matchDurationMinutes}
              min={4}
              max={90}
              onChange={(v) => set('matchDurationMinutes', v)}
            />
            <Check
              label="الدوري ذهاب وإياب"
              checked={form.leagueDoubleRound}
              onChange={(v) => set('leagueDoubleRound', v)}
            />
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <NumberField label="نقاط الفوز" value={form.pointsWin} min={0} max={10} onChange={(v) => set('pointsWin', v)} />
              <NumberField label="نقاط التعادل" value={form.pointsDraw} min={0} max={10} onChange={(v) => set('pointsDraw', v)} />
              <NumberField label="نقاط الخسارة" value={form.pointsLoss} min={0} max={10} onChange={(v) => set('pointsLoss', v)} />
            </div>

            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={labelStyle}>ترتيب الحسم عند التعادل</legend>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBlock: '6px 8px' }}>
                يُطبَّق بالترتيب الظاهر أدناه.
              </p>
              <div style={{ display: 'grid', gap: 6 }}>
                {TIEBREAKER_OPTIONS.map(([value, label]) => {
                  const index = form.tiebreakers.indexOf(value);
                  return (
                    <label
                      key={value}
                      style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}
                    >
                      <input
                        type="checkbox"
                        checked={index >= 0}
                        onChange={(e) =>
                          set(
                            'tiebreakers',
                            e.target.checked
                              ? [...form.tiebreakers, value]
                              : form.tiebreakers.filter((t) => t !== value),
                          )
                        }
                      />
                      {index >= 0 ? (
                        <span className="tag numeric">{index + 1}</span>
                      ) : null}
                      {label}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <NumberField
                label="مقاعد التأهل المباشر"
                value={form.directSemifinalSlots}
                min={0}
                max={8}
                onChange={(v) => set('directSemifinalSlots', v)}
              />
              <NumberField
                label="مقاعد التصفيات"
                value={form.playoffSlots}
                min={0}
                max={16}
                onChange={(v) => set('playoffSlots', v % 2 === 0 ? v : v + 1)}
              />
            </div>

            <Check label="التصفيات ذهاب وإياب" checked={form.knockoutTwoLegs} onChange={(v) => set('knockoutTwoLegs', v)} />
            <Check label="وقت إضافي بعد الإياب عند تعادل المجموع" checked={form.knockoutExtraTime} onChange={(v) => set('knockoutExtraTime', v)} />
            <Check label="ركلات ترجيح" checked={form.knockoutPenalties} onChange={(v) => set('knockoutPenalties', v)} />
            <Check label="قاعدة الهدف خارج الأرض" checked={form.awayGoalsRule} onChange={(v) => set('awayGoalsRule', v)} />

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={labelStyle}>قرعة نصف النهائي</span>
              <select
                className="field"
                value={form.semifinalDrawMode}
                onChange={(e) => set('semifinalDrawMode', e.target.value as 'seeded' | 'open_draw')}
              >
                <option value="seeded">مصنّفة — الأول والثاني لا يلتقيان</option>
                <option value="open_draw">قرعة مفتوحة بين الأربعة</option>
              </select>
            </label>

            <NumberField
              label="فارق الأهداف الذي يُعتبر اكتساحاً"
              value={form.bigWinGoalDiff}
              min={1}
              max={20}
              onChange={(v) => set('bigWinGoalDiff', v)}
            />
          </div>
        ) : null}

        {step === 4 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={labelStyle}>الظهور</span>
              <select
                className="field"
                value={form.visibility}
                onChange={(e) => set('visibility', e.target.value as 'public' | 'invite_only')}
              >
                <option value="invite_only">خاصة — بالكود فقط</option>
                <option value="public">عامة</option>
              </select>
            </label>

            <Check label="تفعيل قائمة الانتظار" checked={form.waitlistEnabled} onChange={(v) => set('waitlistEnabled', v)} />

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <DateTime label="فتح التسجيل" value={form.registrationOpensAt} onChange={(v) => set('registrationOpensAt', v)} />
              <DateTime label="إغلاق التسجيل" value={form.registrationClosesAt} onChange={(v) => set('registrationClosesAt', v)} />
              <DateTime label="بدء تأكيد الحضور" value={form.checkInOpensAt} onChange={(v) => set('checkInOpensAt', v)} />
              <DateTime label="إغلاق تأكيد الحضور" value={form.checkInClosesAt} onChange={(v) => set('checkInClosesAt', v)} />
              <DateTime label="انطلاق البطولة" value={form.startsAt} onChange={(v) => set('startsAt', v)} />
            </div>
          </div>
        ) : null}

        {step === 5 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <Check
              label="إرسال تنبيهات البطولة إلى Telegram"
              checked={form.telegramEnabled}
              onChange={(v) => set('telegramEnabled', v)}
            />
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              تصل التنبيهات لكل مسؤول ربط حسابه من صفحة الملف الشخصي. Telegram قناة تنبيه
              فقط — لا يمكن تغيير أي نتيجة منه.
            </p>

            <Check
              label="تفعيل المراسل الرياضي الآلي"
              checked={form.aiNewsEnabled}
              onChange={(v) => set('aiNewsEnabled', v)}
            />
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={labelStyle}>وضع نشر الأخبار</span>
              <select
                className="field"
                value={form.aiNewsMode}
                disabled={!form.aiNewsEnabled}
                onChange={(e) => set('aiNewsMode', e.target.value as 'review_first' | 'automatic')}
              >
                <option value="review_first">مراجعة أولاً (موصى به)</option>
                <option value="automatic">نشر تلقائي بعد التوثيق</option>
              </select>
            </label>
          </div>
        ) : null}

        {step === 6 ? (
          <div>
            <h2 style={{ fontSize: 18, marginBlockEnd: 14 }}>المراجعة النهائية</h2>
            <dl style={{ margin: 0 }}>
              {review(form, appUrl).map(([term, value]) => (
                <div key={term} className="fact-row" style={{ paddingInline: 0 }}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              تُنشأ البطولة كمسودة. افتح التسجيل من لوحة التحكم بعد مراجعة كل شيء.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 14 }}>
            {error}
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: 10, marginBlockStart: 22, flexWrap: 'wrap' }}>
          {step > 0 ? (
            <button type="button" className="btn" onClick={() => setStep(step - 1)}>
              السابق
            </button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!stepValid}
              onClick={() => setStep(step + 1)}
            >
              التالي
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
              {busy ? 'جارٍ الإنشاء...' : 'إنشاء البطولة'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 13, color: 'var(--text-muted)' };

function Text({
  label,
  value,
  onChange,
  ltr,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ltr?: boolean;
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <input
        className="field"
        dir={ltr ? 'ltr' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <input
        className="field"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function DateTime({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <input
        className="field"
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function toIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function review(form: {
  name: string;
  slug: string;
  capacity: number;
  preset: string;
  visibility: string;
  matchDurationMinutes: number;
  leagueDoubleRound: boolean;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  directSemifinalSlots: number;
  playoffSlots: number;
  knockoutTwoLegs: boolean;
  knockoutExtraTime: boolean;
  knockoutPenalties: boolean;
  awayGoalsRule: boolean;
  semifinalDrawMode: string;
  aiNewsEnabled: boolean;
  aiNewsMode: string;
  telegramEnabled: boolean;
}, appUrl: string): Array<[string, string]> {
  const playoffEnd = form.directSemifinalSlots + form.playoffSlots;
  return [
    ['الاسم', form.name || '—'],
    ['صفحة البطولة', fullTournamentUrl(appUrl, form.slug || '—')],
    ['عدد اللاعبين', String(form.capacity)],
    ['النظام', form.preset],
    ['الظهور', form.visibility === 'public' ? 'عامة' : 'خاصة — بالكود فقط'],
    ['مدة المباراة', `${form.matchDurationMinutes} دقيقة`],
    ['الدوري', form.leagueDoubleRound ? 'ذهاب وإياب' : 'مباراة واحدة'],
    ['النقاط', `${form.pointsWin} / ${form.pointsDraw} / ${form.pointsLoss}`],
    [
      'التأهل',
      [
        form.directSemifinalSlots > 0 ? `1–${form.directSemifinalSlots} ← نصف النهائي` : null,
        form.playoffSlots > 0 ? `${form.directSemifinalSlots + 1}–${playoffEnd} ← التصفيات` : null,
        playoffEnd < form.capacity ? `${playoffEnd + 1}–${form.capacity} ← خروج` : null,
      ]
        .filter(Boolean)
        .join('  ·  ') || '—',
    ],
    ['التصفيات', form.knockoutTwoLegs ? 'ذهاب وإياب' : 'مباراة واحدة'],
    ['الوقت الإضافي', form.knockoutExtraTime ? 'بعد الإياب عند التعادل' : 'لا'],
    ['ركلات الترجيح', form.knockoutPenalties ? 'نعم' : 'لا'],
    ['الهدف خارج الأرض', form.awayGoalsRule ? 'نعم' : 'لا'],
    ['قرعة نصف النهائي', form.semifinalDrawMode === 'seeded' ? 'مصنّفة' : 'مفتوحة'],
    [
      'الأخبار',
      form.aiNewsEnabled
        ? form.aiNewsMode === 'automatic'
          ? 'مراسل آلي — نشر تلقائي'
          : 'مراسل آلي — مراجعة أولاً'
        : 'معطّل',
    ],
    ['Telegram', form.telegramEnabled ? 'مفعّل' : 'معطّل'],
  ];
}


function fullTournamentUrl(appUrl: string, slug: string): string {
  return `${appUrl.replace(/\/$/, '')}/tournaments/${encodeURIComponent(slug)}`;
}
