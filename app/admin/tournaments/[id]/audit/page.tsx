import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ACTION_LABEL: Record<string, string> = {
  TOURNAMENT_CREATED: 'إنشاء البطولة',
  RULES_CONFIGURED: 'ضبط القوانين',
  TOURNAMENT_STATUS_CHANGED: 'تغيير المرحلة',
  PLAYER_JOINED: 'انضمام لاعب',
  PLAYER_APPROVED: 'اعتماد لاعب',
  PLAYER_REMOVED: 'إزالة لاعب',
  PLAYER_DISQUALIFIED: 'استبعاد لاعب',
  PLAYER_CHECKED_IN: 'تأكيد حضور',
  INVITE_CREATED: 'إنشاء دعوة',
  INVITE_REVOKED: 'إلغاء دعوة',
  LEAGUE_SCHEDULE_GENERATED: 'توليد جدول الدوري',
  DRAW_EXECUTED: 'إجراء قرعة',
  EVIDENCE_SUBMITTED: 'إرسال توثيق',
  EVIDENCE_RESUBMISSION_APPROVED: 'الموافقة على إعادة التوثيق',
  EVIDENCE_RESUBMISSION_REJECTED: 'رفض إعادة التوثيق',
  MATCH_VERIFIED: 'اعتماد نتيجة',
  ADMIN_RESULT_OVERRIDE: 'قرار إداري على نتيجة',
  NEWS_APPROVED: 'اعتماد خبر',
  NEWS_MODERATED: 'إجراء على خبر',
  CHAT_MESSAGE_MODERATED: 'إجراء على رسالة',
  TOURNAMENT_COMPLETED: 'اكتمال البطولة',
  TELEGRAM_LINKED: 'ربط Telegram',
};

export default async function AdminAuditPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Read as the signed-in admin. Every table below is gated by an RLS policy
  // on app.is_tournament_admin(), so this page needs no service-role secret —
  // and cannot read past what this particular admin is entitled to see.
  const admin = await createServerSupabase();

  const { data: logs } = await admin
    .from('audit_logs')
    .select('id, action, entity_type, entity_id, reason, actor_id, before_state, after_state, created_at')
    .eq('tournament_id', id)
    .order('created_at', { ascending: false })
    .limit(200);

  const actorIds = [
    ...new Set((logs ?? []).map((l) => l.actor_id).filter((x): x is string => x !== null)),
  ];
  const { data: profiles } = actorIds.length
    ? await admin.from('profiles').select('id, display_name').in('id', actorIds)
    : { data: [] };

  const nameOf = (uid: string | null) =>
    uid ? (profiles?.find((p) => p.id === uid)?.display_name ?? 'مستخدم') : 'النظام';

  if (!logs || logs.length === 0) {
    return (
      <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        لا توجد سجلات.
      </div>
    );
  }

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
      {logs.map((log) => (
        <li
          key={log.id}
          className="panel"
          style={{ padding: '12px 16px', borderRadius: 0 }}
        >
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>
              {ACTION_LABEL[log.action] ?? log.action}
            </strong>
            <time
              dateTime={log.created_at}
              className="numeric"
              style={{ fontSize: 12, color: 'var(--text-muted)' }}
            >
              {new Date(log.created_at).toLocaleString('ar')}
            </time>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBlockStart: 4 }}>
            {nameOf(log.actor_id)}
            {log.entity_type ? ` · ${log.entity_type}` : ''}
          </div>
          {log.reason ? (
            <div style={{ fontSize: 13, marginBlockStart: 4 }}>السبب: {log.reason}</div>
          ) : null}
          {log.before_state || log.after_state ? (
            <details style={{ marginBlockStart: 6 }}>
              <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                التفاصيل
              </summary>
              <pre
                dir="ltr"
                style={{
                  fontSize: 11,
                  overflowX: 'auto',
                  background: 'var(--surface-raised)',
                  padding: 10,
                  marginBlockStart: 6,
                }}
              >
                {JSON.stringify({ before: log.before_state, after: log.after_state }, null, 2)}
              </pre>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
