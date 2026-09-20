-- =============================================================================
-- Demo seed data
--
-- Creates two fictional tournaments with fictional accounts. There are no
-- default passwords and no hidden admin backdoors: the seeded auth users have
-- an empty password hash and cannot sign in. Use them to exercise the public
-- pages, the engines and the admin views, then create real accounts through
-- the normal sign-up flow.
--
-- Apply with:
--   psql "$SUPABASE_DB_URL" -f supabase/seed/seed.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Fictional players
-- -----------------------------------------------------------------------------
create temporary table seed_players (ord int, id uuid, name text) on commit drop;

insert into seed_players (ord, name) values
  (1, 'معتز عمر'),
  (2, 'أحمد وعد'),
  (3, 'علي كرار'),
  (4, 'محمد سيف'),
  (5, 'يوسف طارق'),
  (6, 'زيد ناصر'),
  (7, 'كرم هادي'),
  (8, 'باسل رعد'),
  (9, 'حسن جلال'),
  (10, 'مراد فهد'),
  (11, 'سامي وليد'),
  (12, 'نادر قيس'),
  (13, 'أمجد صابر'),
  (14, 'رامي عادل'),
  (15, 'خالد منير'),
  (16, 'طه عماد'),
  (17, 'ليث سالم');

update seed_players set id = gen_random_uuid();

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, created_at, updated_at
)
select
  p.id,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'demo-player-' || p.ord || '@efootball.invalid',
  '',                                        -- unusable: cannot sign in
  now(),
  jsonb_build_object('display_name', p.name),
  now(),
  now()
from seed_players p
on conflict (id) do nothing;

-- The auth trigger creates the profile rows; top them up with game details.
update public.profiles pr
   set efootball_name = 'EF_' || p.ord,
       platform = (array['ps5','ps4','xbox','pc']::public.gaming_platform[])[1 + (p.ord % 4)]
  from seed_players p
 where pr.id = p.id;

-- -----------------------------------------------------------------------------
-- Demo Tournament A — 8 players, league + playoffs, with verified results
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner uuid;
  v_tournament uuid;
  v_round record;
  v_fixture record;
  v_round_id uuid;
begin
  select id into v_owner from public.profiles order by created_at limit 1;

  insert into public.tournaments (
    slug, name, description, capacity, preset, status, visibility,
    accent_color, platform, prize_info, auto_approve, ai_news_enabled,
    ai_news_mode, created_by, starts_at
  )
  values (
    'friday-cup-demo',
    'بطولة الجمعة',
    'بطولة تجريبية من ثمانية لاعبين: دوري ذهاب وإياب ثم تصفيات ونصف نهائي ونهائي.',
    8, 'league8_double_playoffs', 'registration_open', 'public',
    '#E8FF59', 'ps5', 'لقب البطولة', true, true, 'review_first',
    v_owner, now() + interval '2 days'
  )
  on conflict (slug) do nothing
  returning id into v_tournament;

  if v_tournament is null then
    return; -- already seeded
  end if;

  -- Eight players join through the same path a real player would take.
  insert into public.tournament_players (tournament_id, user_id, status, approved_at)
  select v_tournament, p.id, 'approved', now()
    from (select * from seed_players order by ord limit 8) p;

  update public.tournaments set status = 'registration_full' where id = v_tournament;
  update public.tournaments set status = 'ready_for_draw' where id = v_tournament;
  update public.tournaments set status = 'league_active' where id = v_tournament;

  -- Double round robin, circle method — the same schedule the engine produces.
  create temporary table seed_fixtures (round_number int, leg int, a uuid, b uuid)
    on commit drop;

  declare
    v_ids uuid[];
    v_n int := 8;
    v_rot uuid[];
    v_i int;
    v_r int;
    v_home uuid;
    v_away uuid;
    v_swap boolean;
    v_fixed uuid;
  begin
    select array_agg(id order by ord) into v_ids from (select * from seed_players order by ord limit 8) s;
    v_rot := v_ids;

    for v_r in 0..(v_n - 2) loop
      for v_i in 0..((v_n / 2) - 1) loop
        v_home := v_rot[v_i + 1];
        v_away := v_rot[v_n - v_i];
        v_swap := (v_r % 2 = 1 and v_i = 0);

        insert into seed_fixtures values (
          v_r + 1, 1,
          case when v_swap then v_away else v_home end,
          case when v_swap then v_home else v_away end
        );
        insert into seed_fixtures values (
          (v_n - 1) + v_r + 1, 2,
          case when v_swap then v_home else v_away end,
          case when v_swap then v_away else v_home end
        );
      end loop;

      v_fixed := v_rot[1];
      v_rot := array[v_fixed] || array[v_rot[v_n]] || v_rot[2:v_n - 1];
    end loop;
  end;

  for v_round in select distinct round_number, leg from seed_fixtures order by round_number loop
    insert into public.league_rounds (tournament_id, round_number, leg, label)
    values (v_tournament, v_round.round_number, v_round.leg, 'الجولة ' || v_round.round_number)
    returning id into v_round_id;

    for v_fixture in
      select * from seed_fixtures where round_number = v_round.round_number
    loop
      insert into public.matches (
        tournament_id, stage, round_id, round_number, leg, player_a, player_b, status
      )
      values (v_tournament, 'league', v_round_id, v_fixture.round_number, v_fixture.leg,
              v_fixture.a, v_fixture.b, 'ready');
    end loop;
  end loop;

  -- Verify the first four rounds so the standings, the form guide and the
  -- activity feed all have something real to show.
  update public.matches m
     set score_a = 1 + ((abs(hashtext(m.id::text)) % 4)),
         score_b = (abs(hashtext(m.id::text || 'b')) % 3),
         status = 'verified',
         official_source = 'ai_verified',
         verified_at = now(),
         completed_at = now(),
         winner_id = null
   where m.tournament_id = v_tournament
     and m.round_number <= 4;

  update public.matches
     set winner_id = case
       when score_a > score_b then player_a
       when score_b > score_a then player_b
       else null end
   where tournament_id = v_tournament and status = 'verified';

  insert into public.tournament_activity (tournament_id, kind, message)
  values (v_tournament, 'seed', 'تم تحميل بيانات العرض التجريبي');
end $$;

-- -----------------------------------------------------------------------------
-- Demo Tournament B — 16 players, open for capacity and invite testing
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner uuid;
  v_tournament uuid;
begin
  select id into v_owner from public.profiles order by created_at limit 1;

  insert into public.tournaments (
    slug, name, description, capacity, preset, status, visibility,
    accent_color, auto_approve, waitlist_enabled, created_by
  )
  values (
    'sixteen-invite-demo',
    'بطولة الستة عشر',
    'بطولة تجريبية بالدعوة فقط لاختبار حد المشاركين ونظام الدعوات.',
    16, 'custom', 'registration_open', 'invite_only',
    '#23C883', true, true, v_owner
  )
  on conflict (slug) do nothing
  returning id into v_tournament;

  if v_tournament is null then
    return;
  end if;

  -- 15 of 16 seats taken: one slot left, for exercising the race condition.
  insert into public.tournament_players (tournament_id, user_id, status, approved_at)
  select v_tournament, p.id, 'approved', now()
    from (select * from seed_players order by ord limit 15) p;

  insert into public.tournament_invites (
    tournament_id, label, token, code, max_uses, auto_approve, created_by
  )
  values (
    v_tournament,
    'دعوة تجريبية',
    -- url-safe, like the application's own token generator
    replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'),
    'EF16-DEMO',
    4,
    true,
    v_owner
  );
end $$;

commit;
