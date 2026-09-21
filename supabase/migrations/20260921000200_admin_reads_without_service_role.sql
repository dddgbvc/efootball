-- =============================================================================
-- 2026-09-21 — The admin console reads under the admin's own session
--
-- Every admin section used to render through the service-role key, so the whole
-- console broke wherever that secret was absent. The pages now read as the
-- signed-in admin, which is both simpler to deploy and narrower: an admin sees
-- their own tournament and nothing else.
--
-- One gap remained. A tournament admin can already moderate a reported chat
-- message (chat_messages_admin, FOR UPDATE), but could not *read* it unless
-- they happened to be in the room — so the moderation queue would show a
-- decision with no content to judge. Deciding without reading is worse than
-- not deciding, so the read is granted on exactly the rooms they moderate.
-- =============================================================================

drop policy if exists chat_messages_select_tournament_admin on public.chat_messages;
create policy chat_messages_select_tournament_admin on public.chat_messages
  for select to authenticated
  using (
    app.chat_room_tournament(room_id) is not null
    and app.is_tournament_admin(app.chat_room_tournament(room_id))
  );
