-- =============================================================================
-- 1100 — Immutability must stop an erasure, not a cascade
--
-- Three guards were refusing legitimate cascades, each making a parent row
-- permanently undeletable. Found by applying the schema to a live project and
-- exercising the delete paths.
--
--   1. match_evidence   — deleting a tournament cascades to its matches and then
--                         to their evidence. The guard refused, so any
--                         tournament that had ever received a screenshot could
--                         never be deleted.
--   2. ai_extractions   — same, one level further down.
--   3. chat_messages    — deleting a user nulls sender_id via ON DELETE SET
--                         NULL. The identity guard refused, so any account that
--                         had ever sent a message could never be removed.
--
-- A cascade is distinguishable from a direct write: the RI trigger removes the
-- parent first, so by the time the child's trigger fires the parent is already
-- gone. A direct DELETE still sees its parent and is still refused.
--
-- None of this weakens the guarantees that matter. Evidence still cannot be
-- edited or erased on its own; authorship still cannot be reassigned; a user
-- message still cannot be promoted into a trusted system message.
-- =============================================================================

create or replace function app.guard_evidence_immutability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.matches m where m.id = old.match_id) then
      raise exception 'EVIDENCE_IMMUTABLE: evidence cannot be deleted';
    end if;
    -- Parent match already gone: this is a cascade, let it through.
    return old;
  end if;

  if new.storage_path is distinct from old.storage_path
     or new.file_hash is distinct from old.file_hash
     or new.uploaded_by is distinct from old.uploaded_by
     or new.match_id is distinct from old.match_id
     or new.version is distinct from old.version
     or new.byte_size is distinct from old.byte_size then
    raise exception 'EVIDENCE_IMMUTABLE: only supersede markers may be updated';
  end if;

  return new;
end;
$$;

create or replace function app.guard_extraction_immutability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.match_evidence e where e.id = old.evidence_id) then
    raise exception 'IMMUTABLE_RECORD: ai_extractions rows cannot be deleted';
  end if;
  -- Parent evidence already gone: cascade.
  return old;
end;
$$;

drop trigger if exists ai_extractions_immutable on public.ai_extractions;
create trigger ai_extractions_immutable before delete on public.ai_extractions
  for each row execute function app.guard_extraction_immutability();

-- A 'user' message whose author deleted their account legitimately has no
-- sender. The forgery guarantee lives in the RLS insert policy (which requires
-- sender_id = auth.uid(), so no client can ever write a null-sender message),
-- not in this CHECK.
alter table public.chat_messages drop constraint if exists chat_user_has_sender;

create or replace function app.guard_chat_message_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind
     or new.system_event is distinct from old.system_event
     or new.room_id is distinct from old.room_id
     or new.created_at is distinct from old.created_at then
    raise exception 'CHAT_MESSAGE_IDENTITY_IMMUTABLE';
  end if;

  if new.sender_id is distinct from old.sender_id then
    -- The only permitted authorship change is anonymisation on account
    -- deletion: the old author's profile must already be gone.
    if new.sender_id is not null
       or exists (select 1 from public.profiles p where p.id = old.sender_id) then
      raise exception 'CHAT_MESSAGE_IDENTITY_IMMUTABLE';
    end if;
  end if;

  return new;
end;
$$;
