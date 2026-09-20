-- =============================================================================
-- 0900 — Storage buckets and object policies
--
-- Path conventions (enforced by the policies below):
--   avatars/<user_id>/<file>
--   tournament-media/<tournament_id>/<file>
--   match-evidence/<tournament_id>/<match_id>/<user_id>/<file>
--   chat-attachments/<room_id>/<user_id>/<file>
--   news-media/<tournament_id>/<file>
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',          'avatars',          true,   2097152, array['image/jpeg','image/png','image/webp']),
  ('tournament-media', 'tournament-media', true,   5242880, array['image/jpeg','image/png','image/webp']),
  ('match-evidence',   'match-evidence',   true,  10485760, array['image/jpeg','image/png','image/webp']),
  ('news-media',       'news-media',       true,   5242880, array['image/jpeg','image/png','image/webp']),
  -- Private. Direct-message images must never be reachable by URL alone.
  ('chat-attachments', 'chat-attachments', false,  5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- avatars — world readable, owner writable
-- -----------------------------------------------------------------------------
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'avatars');

drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- tournament-media — world readable, tournament admins writable
-- -----------------------------------------------------------------------------
drop policy if exists tournament_media_read on storage.objects;
create policy tournament_media_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'tournament-media');

drop policy if exists tournament_media_write on storage.objects;
create policy tournament_media_write on storage.objects
  for all to authenticated
  using (
    bucket_id = 'tournament-media'
    and app.is_tournament_admin(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'tournament-media'
    and app.is_tournament_admin(((storage.foldername(name))[1])::uuid)
  );

-- -----------------------------------------------------------------------------
-- match-evidence — evidence is public by design (§38), but only the two
-- participants of that exact match may write into that exact match folder, and
-- nobody may ever overwrite or delete what was written.
-- -----------------------------------------------------------------------------
drop policy if exists match_evidence_read on storage.objects;
create policy match_evidence_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'match-evidence');

drop policy if exists match_evidence_write_participant on storage.objects;
create policy match_evidence_write_participant on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'match-evidence'
    and array_length(storage.foldername(name), 1) >= 3
    and (storage.foldername(name))[3] = auth.uid()::text
    and app.is_match_participant(((storage.foldername(name))[2])::uuid)
    and exists (
      select 1 from public.matches m
      where m.id = ((storage.foldername(name))[2])::uuid
        and m.tournament_id = ((storage.foldername(name))[1])::uuid
        and m.status not in ('verified', 'completed', 'cancelled')
    )
  );

-- No update/delete policy on match-evidence: uploaded evidence is immutable.

-- -----------------------------------------------------------------------------
-- news-media — world readable, tournament members writable
-- -----------------------------------------------------------------------------
drop policy if exists news_media_read on storage.objects;
create policy news_media_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'news-media');

drop policy if exists news_media_write on storage.objects;
create policy news_media_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'news-media'
    and app.is_tournament_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists news_media_delete on storage.objects;
create policy news_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'news-media'
    and (owner_id = auth.uid()::text
         or app.is_tournament_admin(((storage.foldername(name))[1])::uuid))
  );

-- -----------------------------------------------------------------------------
-- chat-attachments — private bucket. Read is gated on membership of the room
-- named by the first path segment, so a leaked object path is worthless to a
-- non-member and signed URLs can only be minted for authorized rooms.
-- -----------------------------------------------------------------------------
drop policy if exists chat_attachments_read_member on storage.objects;
create policy chat_attachments_read_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and app.is_chat_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists chat_attachments_write_member on storage.objects;
create policy chat_attachments_write_member on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[2] = auth.uid()::text
    and app.is_chat_member(((storage.foldername(name))[1])::uuid)
    and not app.is_chat_muted(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists chat_attachments_delete on storage.objects;
create policy chat_attachments_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or (
        app.chat_room_tournament(((storage.foldername(name))[1])::uuid) is not null
        and app.is_tournament_admin(app.chat_room_tournament(((storage.foldername(name))[1])::uuid))
      )
    )
  );
