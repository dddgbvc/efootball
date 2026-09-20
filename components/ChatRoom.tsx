'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface ChatMessageView {
  id: string;
  senderId: string | null;
  kind: string;
  body: string | null;
  systemEvent: string | null;
  createdAt: string;
  deleted: boolean;
}

/**
 * Full-screen conversation with a keyboard-safe composer.
 *
 * The Realtime subscription is filtered to this room and the chat_messages
 * SELECT policy restricts delivery to members, so subscribing to a room id you
 * do not belong to yields an empty stream rather than someone else's messages.
 */
export function ChatRoom({
  roomId,
  currentUserId,
  names,
  initial,
}: {
  roomId: string;
  currentUserId: string;
  names: Record<string, string>;
  initial: ChatMessageView[];
}) {
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            sender_id: string | null;
            kind: string;
            body: string | null;
            system_event: string | null;
            created_at: string;
            deleted_at: string | null;
          };

          setMessages((current) =>
            current.some((m) => m.id === row.id)
              ? current
              : [
                  ...current,
                  {
                    id: row.id,
                    senderId: row.sender_id,
                    kind: row.kind,
                    body: row.body,
                    systemEvent: row.system_event,
                    createdAt: row.created_at,
                    deleted: row.deleted_at !== null,
                  },
                ],
          );
        },
      )
      .subscribe();

    void supabase.rpc('mark_room_read', { p_room_id: roomId, p_message_id: null });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, body }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!payload.ok) setError(payload.message ?? 'تعذر الإرسال');
      else setDraft('');
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100dvh - 190px)',
      }}
    >
      <ol
        style={{
          flex: 1,
          listStyle: 'none',
          margin: 0,
          padding: '16px 0',
          display: 'grid',
          gap: 8,
          alignContent: 'start',
          overflowY: 'auto',
        }}
      >
        {messages.map((message) => {
          if (message.kind === 'system') {
            return (
              <li key={message.id} style={{ textAlign: 'center' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '6px 12px',
                    border: '1px dashed var(--line-strong)',
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {message.body}
                </span>
              </li>
            );
          }

          const mine = message.senderId === currentUserId;
          return (
            <li
              key={message.id}
              style={{ display: 'flex', justifyContent: mine ? 'flex-start' : 'flex-end' }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  padding: '9px 12px',
                  background: mine ? 'var(--accent)' : 'var(--surface-panel)',
                  color: mine ? 'var(--accent-ink)' : 'inherit',
                  border: `1px solid ${mine ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 4,
                }}
              >
                {!mine && message.senderId ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBlockEnd: 3 }}>
                    {names[message.senderId] ?? 'لاعب'}
                  </div>
                ) : null}
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>
                  {message.deleted ? (
                    <em style={{ opacity: 0.7 }}>حُذفت هذه الرسالة</em>
                  ) : (
                    message.body
                  )}
                </div>
                <time
                  dateTime={message.createdAt}
                  className="numeric"
                  style={{ display: 'block', fontSize: 10, opacity: 0.6, marginBlockStart: 3 }}
                  dir="ltr"
                >
                  {new Date(message.createdAt).toLocaleTimeString('ar', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            </li>
          );
        })}
        <div ref={endRef} />
      </ol>

      {error ? (
        <p role="alert" style={{ color: 'var(--color-alert-400)', fontSize: 13 }}>
          {error}
        </p>
      ) : null}

      <form
        onSubmit={send}
        style={{
          display: 'flex',
          gap: 8,
          position: 'sticky',
          bottom: 0,
          background: 'var(--surface)',
          paddingBlock: 12,
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          borderTop: '1px solid var(--line)',
        }}
      >
        <input
          className="field"
          placeholder="اكتب رسالة..."
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
          إرسال
        </button>
      </form>
    </div>
  );
}
