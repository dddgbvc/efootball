-- =============================================================================
-- 0500 — News, chat, notifications, Telegram, moderation
-- =============================================================================

-- -----------------------------------------------------------------------------
-- news
-- -----------------------------------------------------------------------------
create table if not exists public.news_posts (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references public.tournaments (id) on delete cascade,
  source          public.news_source not null,
  label           public.news_label not null default 'PLAYER_POST',
  author_id       uuid references public.profiles (id) on delete set null,
  title           text,
  body            text not null,
  status          public.news_status not null default 'draft',
  pinned          boolean not null default false,
  source_match_id uuid references public.matches (id) on delete set null,
  facts           jsonb not null default '{}'::jsonb,
  event_key       text,
  approved_by     uuid references public.profiles (id) on delete set null,
  published_at    timestamptz,
  invalidated_at  timestamptz,
  invalidation_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint news_body_len check (char_length(body) between 1 and 4000),
  constraint news_title_len check (title is null or char_length(title) <= 160),
  -- A player post always carries its author; an AI/system story never claims one.
  constraint news_author_matches_source check (
    (source = 'player' and author_id is not null)
    or (source <> 'player' and author_id is null)
  ),
  -- Official AI match stories must reference the verified match they came from.
  constraint news_ai_references_match check (
    source <> 'ai_reporter' or label = 'BREAKING' or source_match_id is not null
  )
);

-- One AI article per official event; makes the reaction pipeline idempotent.
create unique index if not exists news_posts_event_key_unique
  on public.news_posts (event_key) where event_key is not null;
create index if not exists news_posts_feed_idx
  on public.news_posts (tournament_id, status, published_at desc);

create table if not exists public.news_post_media (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.news_posts (id) on delete cascade,
  storage_path text not null unique,
  mime_type    text not null,
  byte_size    integer not null,
  created_at   timestamptz not null default now(),
  constraint news_media_mime check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint news_media_size check (byte_size > 0 and byte_size <= 5242880)
);

create table if not exists public.news_reactions (
  post_id    uuid not null references public.news_posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji),
  constraint news_reaction_emoji check (emoji in ('❤️', '🔥', '👏', '😂'))
);

create table if not exists public.news_reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.news_posts (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text not null,
  created_at  timestamptz not null default now(),
  unique (post_id, reporter_id)
);

-- -----------------------------------------------------------------------------
-- chat
-- -----------------------------------------------------------------------------
create table if not exists public.chat_rooms (
  id            uuid primary key default gen_random_uuid(),
  type          public.chat_room_type not null,
  tournament_id uuid references public.tournaments (id) on delete cascade,
  title         text,
  dm_key        text,
  created_at    timestamptz not null default now(),
  constraint chat_rooms_group_has_tournament check (
    type <> 'tournament_group' or tournament_id is not null
  ),
  constraint chat_rooms_direct_has_key check (
    type <> 'direct' or dm_key is not null
  )
);

-- One group per tournament, one direct room per unordered user pair.
create unique index if not exists chat_rooms_tournament_group_unique
  on public.chat_rooms (tournament_id) where type = 'tournament_group';
create unique index if not exists chat_rooms_dm_key_unique
  on public.chat_rooms (dm_key) where type = 'direct';

create table if not exists public.chat_room_members (
  room_id   uuid not null references public.chat_rooms (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  constraint chat_member_role check (role in ('member', 'admin'))
);

create index if not exists chat_room_members_user_idx on public.chat_room_members (user_id);

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.chat_rooms (id) on delete cascade,
  sender_id   uuid references public.profiles (id) on delete set null,
  kind        public.chat_message_kind not null default 'user',
  body        text,
  reply_to_id uuid references public.chat_messages (id) on delete set null,
  pinned      boolean not null default false,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id) on delete set null,
  system_event text,
  created_at  timestamptz not null default now(),
  constraint chat_body_len check (body is null or char_length(body) <= 2000),
  -- A system message has no human sender and can therefore never be forged by
  -- a client insert: the RLS policy requires sender_id = auth.uid().
  constraint chat_system_has_no_sender check (kind <> 'system' or sender_id is null),
  constraint chat_user_has_sender check (kind <> 'user' or sender_id is not null)
);

create index if not exists chat_messages_room_idx on public.chat_messages (room_id, created_at desc);

create table if not exists public.chat_message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.chat_messages (id) on delete cascade,
  room_id      uuid not null references public.chat_rooms (id) on delete cascade,
  storage_path text not null unique,
  mime_type    text not null,
  byte_size    integer not null,
  width        integer,
  height       integer,
  created_at   timestamptz not null default now(),
  constraint chat_attachment_mime check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint chat_attachment_size check (byte_size > 0 and byte_size <= 5242880)
);

create index if not exists chat_attachments_room_idx on public.chat_message_attachments (room_id);

create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint chat_reaction_emoji check (char_length(emoji) between 1 and 8)
);

create table if not exists public.chat_read_state (
  room_id            uuid not null references public.chat_rooms (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  last_read_at       timestamptz not null default now(),
  last_read_message_id uuid references public.chat_messages (id) on delete set null,
  primary key (room_id, user_id)
);

create table if not exists public.chat_mutes (
  room_id     uuid not null references public.chat_rooms (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  muted_until timestamptz,
  muted_by    uuid references public.profiles (id) on delete set null,
  reason      text,
  created_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.player_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  tournament_id uuid references public.tournaments (id) on delete cascade,
  type          text not null,
  title         text not null,
  body          text,
  link          text,
  event_key     text,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create unique index if not exists notifications_event_key_unique
  on public.notifications (user_id, event_key) where event_key is not null;

-- -----------------------------------------------------------------------------
-- telegram
-- -----------------------------------------------------------------------------
create table if not exists public.telegram_connections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  chat_id      bigint,
  username     text,
  link_token   text unique,
  token_expires_at timestamptz,
  linked_at    timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id)
);

create unique index if not exists telegram_connections_chat_unique
  on public.telegram_connections (chat_id) where chat_id is not null and revoked_at is null;

create table if not exists public.telegram_outbox (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments (id) on delete cascade,
  event_key     text not null unique,
  chat_id       bigint not null,
  text_body     text not null,
  reply_markup  jsonb,
  status        public.outbox_status not null default 'pending',
  attempts      smallint not null default 0,
  last_error    text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists telegram_outbox_status_idx on public.telegram_outbox (status, created_at);

create table if not exists public.telegram_updates (
  update_id  bigint primary key,
  received_at timestamptz not null default now(),
  payload    jsonb not null
);

-- -----------------------------------------------------------------------------
-- moderation
-- -----------------------------------------------------------------------------
create table if not exists public.moderation_reports (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments (id) on delete cascade,
  target        public.report_target not null,
  target_id     uuid not null,
  reporter_id   uuid not null references public.profiles (id) on delete cascade,
  reported_user uuid references public.profiles (id) on delete set null,
  reason        text not null,
  status        public.report_status not null default 'open',
  handled_by    uuid references public.profiles (id) on delete set null,
  handled_at    timestamptz,
  action_taken  text,
  created_at    timestamptz not null default now(),
  unique (target, target_id, reporter_id),
  constraint moderation_reason_len check (char_length(reason) between 3 and 500)
);

create index if not exists moderation_reports_status_idx
  on public.moderation_reports (tournament_id, status, created_at desc);

-- -----------------------------------------------------------------------------
-- activity feed ("نبض البطولة")
-- -----------------------------------------------------------------------------
create table if not exists public.tournament_activity (
  id            bigint generated always as identity primary key,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  kind          text not null,
  message       text not null,
  link          text,
  actor_id      uuid references public.profiles (id) on delete set null,
  match_id      uuid references public.matches (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists tournament_activity_idx
  on public.tournament_activity (tournament_id, created_at desc);
