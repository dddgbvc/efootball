import Link from 'next/link';
import { Avatar } from './Avatar';
import type { PlayerMatch } from '@/lib/player/context';
import type { MatchStatus } from '@/types/database';

const STATE_LABEL: Record<MatchStatus, string> = {
  pending: 'لم تبدأ',
  ready: 'جاهزة للعب',
  live: 'جارية',
  awaiting_first_evidence: 'بانتظار توثيقك',
  awaiting_second_evidence: 'بانتظار توثيق الخصم',
  ai_verifying: 'قيد التحقق',
  awaiting_verification: 'بانتظار التحقق',
  review_required: 'بانتظار قرار المسؤول',
  verified: 'مكتملة',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

/**
 * The one match a player may act on.
 *
 * When there is no such match the card says which of the two reasons applies,
 * because "الجولة القادمة مقفلة" and "لم تُحدد المباراة بعد" are different
 * situations and a player who cannot tell them apart will ask the organiser.
 * Neither message names the opponent waiting on the other side.
 */
export function NextMatchCard({
  match,
  hasHiddenNext,
  viewer,
}: {
  match: PlayerMatch | null;
  hasHiddenNext: boolean;
  viewer: { name: string; avatarPath: string | null };
}) {
  if (!match) {
    return (
      <div className="panel player-empty">
        {hasHiddenNext
          ? 'أكمل مباراتك الحالية أولاً لفتح الجولة التالية.'
          : 'لم يتم تحديد المباراة القادمة بعد.'}
      </div>
    );
  }

  return (
    <article className="panel next-match">
      <div className="next-match-head">
        <span className="eyebrow">
          {match.roundNumber ? `الجولة ${match.roundNumber}` : stageLabel(match.stage)}
          {match.leg === 2 ? ' · إياب' : match.leg === 1 ? ' · ذهاب' : ''}
        </span>
        <span className="tag">{STATE_LABEL[match.status]}</span>
      </div>

      <div className="next-match-body">
        <div className="next-match-side">
          <Avatar path={viewer.avatarPath} name={viewer.name} size={44} />
          <span>{viewer.name}</span>
        </div>
        <span className="next-match-vs">VS</span>
        <div className="next-match-side">
          <Avatar path={match.opponentAvatar} name={match.opponentName} size={44} />
          <span>{match.opponentName}</span>
        </div>
      </div>

      <div className="next-match-meta">
        {match.scheduledAt
          ? new Date(match.scheduledAt).toLocaleString('ar', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'الموعد غير محدد — اتفق مع خصمك عليه.'}
      </div>

      <div className="next-match-actions">
        <Link href={`/player/matches/${match.id}`} className="btn btn-primary">
          فتح المباراة
        </Link>
        <Link href={`/player/messages/new?to=${match.opponentId}`} className="btn">
          مراسلة الخصم
        </Link>
      </div>
    </article>
  );
}

function stageLabel(stage: string): string {
  return (
    {
      league: 'الدوري',
      playoff: 'التصفيات',
      semifinal: 'نصف النهائي',
      third_place: 'تحديد المركز الثالث',
      final: 'النهائي',
    }[stage] ?? 'مباراة'
  );
}

export { STATE_LABEL as MATCH_STATE_LABEL };
