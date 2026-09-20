import { createAdminClient } from '@/lib/supabase/admin';
import { requireMatchParticipant, AuthorizationError } from '@/lib/permissions';
import { submitEvidenceSchema } from '@/lib/validation/schemas';
import { handleRouteError, ok, fail, parseBody } from '@/lib/api/respond';
import { rateLimit } from '@/lib/api/rateLimit';
import { processMatchVerification } from '@/lib/ai/pipeline';
import { notifyTournamentAdmins } from '@/lib/telegram/notify';
import { firstEvidenceMessage } from '@/lib/telegram/messages';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Registers a screenshot that the player already uploaded to Storage.
 *
 * The object itself was written under a Storage policy that only lets a
 * participant write into `<tournament>/<match>/<their own uid>/`, so the path
 * in the body cannot point at someone else's evidence. Here we verify the
 * object actually exists, pin its hash, and hand off to the pipeline.
 */
export async function POST(request: Request, context: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await context.params;
    const { user, match } = await requireMatchParticipant(matchId);

    const limit = rateLimit(`evidence:${user.id}`, 20, 10 * 60 * 1000);
    if (!limit.allowed) return fail('RATE_LIMITED', 'عدد كبير من المحاولات', 429);

    const input = await parseBody(request, submitEvidenceSchema);
    if (input.matchId !== matchId) {
      return fail('MATCH_MISMATCH', 'معرّف المباراة غير مطابق', 400);
    }

    if (['verified', 'completed', 'cancelled'].includes(match.status)) {
      return fail('MATCH_ALREADY_OFFICIAL', 'تم اعتماد نتيجة هذه المباراة بالفعل', 409);
    }

    const expectedPrefix = `${match.tournament_id}/${matchId}/${user.id}/`;
    if (!input.storagePath.startsWith(expectedPrefix)) {
      throw new AuthorizationError('FORBIDDEN', 'مسار الملف غير صالح');
    }

    const admin = createAdminClient();

    const { data: object, error: objectError } = await admin.storage
      .from('match-evidence')
      .download(input.storagePath);

    if (objectError || !object) {
      return fail('EVIDENCE_NOT_UPLOADED', 'لم يتم العثور على الصورة المرفوعة', 404);
    }
    if (object.size !== input.byteSize) {
      return fail('EVIDENCE_SIZE_MISMATCH', 'حجم الملف لا يطابق المعلن', 400);
    }

    // Hash the bytes we actually hold rather than trusting the client's claim.
    const digest = await crypto.subtle.digest('SHA-256', await object.arrayBuffer());
    const actualHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    if (actualHash !== input.fileHash) {
      return fail('EVIDENCE_HASH_MISMATCH', 'بصمة الملف غير مطابقة', 400);
    }

    const { data: submission, error: submissionError } = await admin
      .from('match_submissions')
      .upsert(
        {
          match_id: matchId,
          user_id: user.id,
          claimed_score_a: input.claimedScoreA ?? null,
          claimed_score_b: input.claimedScoreB ?? null,
        },
        { onConflict: 'match_id,user_id', ignoreDuplicates: false },
      )
      .select('id, current_version')
      .single();

    if (submissionError) throw new Error(submissionError.message);

    const { data: previous } = await admin
      .from('match_evidence')
      .select('id, version')
      .eq('match_id', matchId)
      .eq('uploaded_by', user.id)
      .is('superseded_at', null)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Evidence is immutable: a re-submission is only possible when an admin has
    // approved a correction, which bumps current_version above what exists.
    if (previous && previous.version >= submission.current_version) {
      return fail(
        'EVIDENCE_ALREADY_SUBMITTED',
        'لقد أرسلت توثيقك بالفعل. اطلب تصحيح التوثيق إذا كان هناك خطأ.',
        409,
      );
    }

    const { data: evidence, error: evidenceError } = await admin
      .from('match_evidence')
      .insert({
        match_id: matchId,
        submission_id: submission.id,
        uploaded_by: user.id,
        storage_path: input.storagePath,
        file_hash: actualHash,
        mime_type: input.mimeType,
        byte_size: input.byteSize,
        width: input.width ?? null,
        height: input.height ?? null,
        version: submission.current_version,
      })
      .select('id')
      .single();

    if (evidenceError) throw new Error(`EVIDENCE_INSERT_FAILED: ${evidenceError.message}`);

    if (previous) {
      await admin
        .from('match_evidence')
        .update({ superseded_at: new Date().toISOString(), superseded_by: evidence.id })
        .eq('id', previous.id);
    }

    const opponentId = match.player_a === user.id ? match.player_b : match.player_a;

    const { data: opponentEvidence } = await admin
      .from('match_evidence')
      .select('id')
      .eq('match_id', matchId)
      .eq('uploaded_by', opponentId)
      .is('superseded_at', null)
      .maybeSingle();

    if (!opponentEvidence) {
      const [{ data: tournament }, { data: profiles }] = await Promise.all([
        admin.from('tournaments').select('name').eq('id', match.tournament_id).maybeSingle(),
        admin.from('profiles').select('id, display_name').in('id', [user.id, opponentId]),
      ]);

      const nameOf = (uid: string) =>
        profiles?.find((p) => p.id === uid)?.display_name ?? 'لاعب';

      await notifyTournamentAdmins(
        match.tournament_id,
        `evidence-first:${evidence.id}`,
        firstEvidenceMessage({
          tournamentName: tournament?.name ?? '',
          tournamentId: match.tournament_id,
          matchId,
          submitter: nameOf(user.id),
          waitingOn: nameOf(opponentId),
        }),
      );

      await admin.from('notifications').insert({
        user_id: opponentId,
        tournament_id: match.tournament_id,
        type: 'evidence_awaiting',
        title: 'بانتظار توثيقك',
        body: `${nameOf(user.id)} أرسل صورة النتيجة. أرسل صورتك لإتمام التوثيق.`,
        link: `/match/${matchId}`,
        event_key: `evidence_awaiting:${evidence.id}`,
      });

      return ok({ state: 'awaiting_second_evidence', evidenceId: evidence.id }, 201);
    }

    const outcome = await processMatchVerification(matchId);
    return ok({ state: outcome.state, evidenceId: evidence.id, outcome }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
