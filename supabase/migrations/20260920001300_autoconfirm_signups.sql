-- =============================================================================
-- 1300 — Registration without an email confirmation step
--
-- The platform verifies people by what they do in a tournament, not by whether
-- they can open a mailbox. A confirmation round trip only adds a link that can
-- break: it is minted against the Supabase Site URL, so a stale or unlisted
-- redirect sends the player to a dead page with no way back.
--
-- New accounts are therefore confirmed as they are inserted. GoTrue still
-- decides on its own whether a sign-up returns a session, so the application
-- signs the player in straight after registering; this trigger is what makes
-- that second call succeed. `coalesce` means that turning "Confirm email" off
-- in the dashboard changes nothing here — GoTrue's own value wins when it
-- sets one.
-- =============================================================================

create or replace function app.autoconfirm_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;

grant usage on schema app to supabase_auth_admin;
grant execute on function app.autoconfirm_new_user() to supabase_auth_admin;

drop trigger if exists autoconfirm_new_user on auth.users;
create trigger autoconfirm_new_user
  before insert on auth.users
  for each row execute function app.autoconfirm_new_user();

-- Anyone who already registered and never received a working link.
update auth.users
   set email_confirmed_at = now()
 where email_confirmed_at is null;
