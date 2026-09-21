import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/server';
import { loadRules } from '@/lib/tournament/queries';
import { RulesSheet } from '@/components/RulesSheet';
import { JoinPanel } from '@/components/JoinPanel';

export const dynamic = 'force-dynamic';

/**
 * The invitation landing page.
 *
 * The invite row is read with the service role because `tournament_invites` is
 * admin-only under RLS — a player must never be able to enumerate tokens. Only
 * the derived, non-sensitive facts are rendered.
 */
async function loadInvite(token: string) {
  const admin = createAdminClient();

  const { data: invite } = await admin
    .from('tournament_invites')
    .select(
      'id, tournament_id, label, max_uses, used_count, expires_at, revoked_at, auto_approve, opened_at',
    )
    .eq('token', token)
    .maybeSingle();

  if (!invite) return null;

  const { data: tournament } = await admin
    .from('tournaments')
    .select(
      'id, slug, name, description, cover_path, accent_color, capacity, player_count, status, starts_at, prize_info, visibility',
    )
    .eq('id', invite.tournament_id)
    .maybeSingle();

  if (!tournament) return null;

  const now = new Date();
  const state = invite.revoked_at
    ? ('revoked' as const)
    : invite.expires_at && new Date(invite.expires_at) < now
      ? ('expired' as const)
      : invite.max_uses !== null && invite.used_count >= invite.max_uses
        ? ('exhausted' as const)
        : tournament.player_count >= tournament.capacity
          ? ('full' as const)
          : tournament.status !== 'registration_open'
            ? ('closed' as const)
            : ('open' as const);

  // First view of the link is a real event the organiser needs: "sent" and
  // "opened" are different things to chase up.
  if (!invite.opened_at) {
    await admin
      .from('tournament_invites')
      .update({ opened_at: new Date().toISOString() })
      .eq('id', invite.id);
  }

  return { invite, tournament, state };
}

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await props.params;
  const result = await loadInvite(token);
  if (!result) return { title: 'دعوة غير صالحة' };

  // The preview reveals tournament identity only — never invite counts,
  // admin data, or the token itself.
  return {
    title: `دعوة — ${result.tournament.name}`,
    description:
      result.tournament.description ??
      `بطولة eFootball بعدد ${result.tournament.capacity} لاعبين.`,
    robots: { index: false, follow: false },
  };
}

const STATE_MESSAGE: Record<string, string> = {
  revoked: 'تم إلغاء هذه الدعوة.',
  expired: 'انتهت صلاحية الدعوة.',
  exhausted: 'تم استخدام هذه الدعوة بالكامل.',
  full: 'اكتمل عدد المشاركين.',
  closed: 'التسجيل مغلق حالياً.',
};

export default async function JoinPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const result = await loadInvite(token);
  if (!result) notFound();

  const { tournament, state } = result;
  const user = await getCurrentUser();

  const admin = createAdminClient();
  const rules = await loadRules(admin, tournament.id);

  const alreadyJoined = user
    ? Boolean(
        (
          await admin
            .from('tournament_players')
            .select('id')
            .eq('tournament_id', tournament.id)
            .eq('user_id', user.id)
            .maybeSingle()
        ).data,
      )
    : false;

  const remaining = tournament.capacity - tournament.player_count;

  return (
    <div className="shell" style={{ paddingBlock: '40px 80px', maxWidth: 820 }}>
      <div
        aria-hidden
        style={{ height: 4, width: 72, background: tournament.accent_color, marginBlockEnd: 16 }}
      />
      <div className="eyebrow">مرحباً بك في البطولة — تمت دعوتك للمشاركة في</div>
      <h1 style={{ fontSize: 'clamp(1.9rem, 5vw, 2.8rem)', marginBlock: '10px 12px' }}>
        {tournament.name}
      </h1>
      {result.invite.label ? (
        <p style={{ margin: '0 0 6px', fontSize: 15 }}>
          <span style={{ color: 'var(--text-muted)' }}>اللاعب: </span>
          <strong>{result.invite.label}</strong>
        </p>
      ) : null}
      {tournament.description ? (
        <p style={{ color: 'var(--text-muted)', maxWidth: 620 }}>{tournament.description}</p>
      ) : null}

      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          marginBlock: '24px 28px',
        }}
      >
        <Fact label="عدد اللاعبين" value={`${tournament.player_count} / ${tournament.capacity}`} />
        <Fact
          label="المقاعد المتبقية"
          value={remaining > 0 ? String(remaining) : 'لا شيء'}
          alert={remaining <= 0}
        />
        <Fact
          label="موعد الانطلاق"
          value={
            tournament.starts_at
              ? new Date(tournament.starts_at).toLocaleDateString('ar', {
                  day: 'numeric',
                  month: 'long',
                })
              : 'يُحدد لاحقاً'
          }
        />
        <Fact label="الجائزة" value={tournament.prize_info ?? '—'} />
      </div>

      {state !== 'open' ? (
        <div
          className="panel"
          role="status"
          style={{
            padding: 22,
            borderColor: 'var(--color-alert-500)',
            color: 'var(--color-alert-400)',
            fontWeight: 700,
            marginBlockEnd: 24,
          }}
        >
          {STATE_MESSAGE[state]}
        </div>
      ) : alreadyJoined ? (
        <div className="panel" style={{ padding: 22, marginBlockEnd: 24 }}>
          أنت مشارك في هذه البطولة بالفعل.{' '}
          <Link href={`/tournaments/${tournament.slug}`} style={{ color: 'var(--accent)' }}>
            افتح صفحة البطولة ←
          </Link>
        </div>
      ) : (
        <JoinPanel
          tournamentId={tournament.id}
          inviteToken={token}
          signedIn={Boolean(user)}
        />
      )}

      <section style={{ marginBlockStart: 32 }}>
        <h2 className="eyebrow" style={{ marginBlockEnd: 12 }}>
          قوانين البطولة
        </h2>
        <RulesSheet rules={rules} capacity={tournament.capacity} />
      </section>
    </div>
  );
}

function Fact({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="panel strip" style={{ padding: '14px 16px 16px' }}>
      <div className="eyebrow">{label}</div>
      <div
        className="numeric"
        style={{
          fontSize: 18,
          fontWeight: 800,
          marginBlockStart: 6,
          color: alert ? 'var(--color-alert-400)' : 'inherit',
        }}
      >
        {value}
      </div>
    </div>
  );
}
