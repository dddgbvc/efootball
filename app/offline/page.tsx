export const metadata = { title: 'لا يوجد اتصال' };

/**
 * The only page the service worker is allowed to serve from cache, and the
 * reason it says nothing about the tournament: a cached score is worse than no
 * score.
 */
export default function OfflinePage() {
  return (
    <div className="shell" style={{ paddingBlock: '72px 96px', maxWidth: 520 }}>
      <div className="panel strip" style={{ padding: '28px 22px 30px' }}>
        <div className="eyebrow">لا يوجد اتصال</div>
        <h1 style={{ fontSize: 24, marginBlock: '10px 12px' }}>أنت غير متصل بالإنترنت</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>
          نتائج البطولة وترتيبها تتغير باستمرار، فلا تُعرض من الذاكرة المؤقتة. أعد المحاولة
          بعد عودة الاتصال.
        </p>
      </div>
    </div>
  );
}
