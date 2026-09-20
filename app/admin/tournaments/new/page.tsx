import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { PRESETS } from '@/lib/tournament/presets';
import { CreateTournamentWizard } from '@/components/admin/CreateTournamentWizard';

export const metadata = { title: 'بطولة جديدة' };

export default async function NewTournamentPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/admin/tournaments/new');

  return (
    <div className="shell" style={{ paddingBlock: '36px 80px', maxWidth: 860 }}>
      <div className="eyebrow">إنشاء بطولة</div>
      <h1 style={{ fontSize: 30, marginBlock: '10px 26px' }}>بطولة جديدة</h1>
      <CreateTournamentWizard
        appUrl={(
          process.env.NEXT_PUBLIC_APP_URL ??
          (process.env.VERCEL_PROJECT_PRODUCTION_URL
            ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
            : 'https://efootball-iota.vercel.app')
        ).replace(/\/$/, '')}
        presets={PRESETS.map((p) => ({
          id: p.id,
          nameAr: p.nameAr,
          descriptionAr: p.descriptionAr,
          capacities: p.capacities,
          productionReady: p.productionReady,
        }))}
      />
    </div>
  );
}
