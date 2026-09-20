import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import {
  EXTRACTION_JSON_CONTRACT,
  safeParseExtraction,
  type VisionExtraction,
} from './schema';

export const VISION_MODEL = 'claude-opus-5';
export const VISION_PROVIDER = 'anthropic';

/**
 * Wire shape handed to the model.
 *
 * Statistics travel as a list rather than an open map because structured
 * outputs constrain object keys; it is folded back into the extensible record
 * that the rest of the system uses immediately after parsing. The list itself
 * is open-ended — the model is told to return every metric it can see, not a
 * fixed set.
 */
const wireStatisticSchema = z.object({
  key: z.string().describe('snake_case metric name, e.g. possession, shots_on_target'),
  labelAr: z.string().nullable().describe('Arabic label as printed on screen, if visible'),
  playerA: z.number(),
  playerB: z.number(),
  unit: z.string().nullable(),
});

const wireSideSchema = z.object({
  name: z.string().nullable(),
  team: z.string().nullable(),
  logoDetected: z.boolean(),
  logoDescription: z.string().nullable(),
});

const wireExtractionSchema = z.object({
  validResultScreen: z.boolean(),
  game: z.string(),
  screenType: z.string().nullable(),
  playerA: wireSideSchema,
  playerB: wireSideSchema,
  scoreA: z.number().int(),
  scoreB: z.number().int(),
  penaltiesA: z.number().int().nullable(),
  penaltiesB: z.number().int().nullable(),
  statistics: z.array(wireStatisticSchema),
  confidenceOverall: z.number(),
  confidenceScore: z.number(),
  confidenceIdentity: z.number(),
  confidenceStatistics: z.number(),
  notes: z.string().nullable(),
});

const SYSTEM_PROMPT = `أنت محلل صور نتائج مباريات eFootball. مهمتك استخراج كل ما هو مرئي في شاشة النتيجة/الإحصائيات.

القواعد:
1. حلّل الشاشة بالكامل: أسماء اللاعبين، أسماء الفرق، شعارات الأندية، النتيجة، وكل الإحصائيات الظاهرة.
2. لا تعتمد على قراءة النص وحده. انظر إلى شعار كل فريق وتعرّف عليه بصرياً، وحدّد ما إذا كانت الشاشة فعلاً شاشة نتيجة من لعبة eFootball.
3. "playerA" هو الطرف الأيسر/الأول في الشاشة و"playerB" هو الطرف الثاني.
4. أعد كل إحصائية ظاهرة في القائمة، ولا تقتصر على قائمة محددة مسبقاً. استخدم مفاتيح snake_case إنجليزية.
5. لا تخمّن. إذا لم تتمكن من قراءة حقل، أعِد null واخفض درجة الثقة المناسبة.
6. إذا لم تكن الصورة شاشة نتيجة صالحة، اضبط validResultScreen = false.
7. درجات الثقة أرقام بين 0 و 1 وتعبّر عن يقينك الحقيقي.

الشكل المطلوب مكافئ لـ:
${EXTRACTION_JSON_CONTRACT}`;

export interface VisionRequest {
  imageBase64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Names the two participants are registered under, used only as a hint. */
  contextHint?: { playerAName?: string; playerBName?: string; tournamentName?: string };
}

export type VisionOutcome =
  | { ok: true; extraction: VisionExtraction; raw: unknown; model: string; provider: string }
  | { ok: false; error: 'AI_UNAVAILABLE' | 'INVALID_OUTPUT'; detail: string; raw?: unknown };

export interface VisionClient {
  extract(request: VisionRequest): Promise<VisionOutcome>;
}

class AnthropicVisionClient implements VisionClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extract(request: VisionRequest): Promise<VisionOutcome> {
    const hints: string[] = [];
    if (request.contextHint?.tournamentName) {
      hints.push(`البطولة: ${request.contextHint.tournamentName}`);
    }
    if (request.contextHint?.playerAName || request.contextHint?.playerBName) {
      hints.push(
        `اللاعبان المسجلان في هذه المباراة: ${request.contextHint.playerAName ?? '?'} و ${request.contextHint.playerBName ?? '?'}. لا تفترض أن الصورة تخصهما — اقرأ ما هو مكتوب فعلاً.`,
      );
    }

    let response;
    try {
      response = await this.client.messages.parse({
        model: VISION_MODEL,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(wireExtractionSchema) },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: request.mediaType,
                  data: request.imageBase64,
                },
              },
              {
                type: 'text',
                text:
                  hints.length > 0
                    ? `${hints.join('\n')}\n\nاستخرج بيانات هذه الشاشة.`
                    : 'استخرج بيانات هذه الشاشة.',
              },
            ],
          },
        ],
      });
    } catch (error) {
      // Provider outage, rate limit, network failure — evidence is already
      // stored, so the caller retries rather than losing anything.
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, error: 'AI_UNAVAILABLE', detail };
    }

    if (response.stop_reason === 'refusal') {
      return {
        ok: false,
        error: 'AI_UNAVAILABLE',
        detail: `refusal: ${response.stop_details?.category ?? 'unknown'}`,
      };
    }

    const wire = response.parsed_output;
    if (!wire) {
      return { ok: false, error: 'INVALID_OUTPUT', detail: 'model returned no parsable output' };
    }

    const normalized = fromWire(wire);
    const parsed = safeParseExtraction(normalized);
    if (!parsed.ok) {
      return {
        ok: false,
        error: 'INVALID_OUTPUT',
        detail: parsed.issues.join('; '),
        raw: wire,
      };
    }

    return {
      ok: true,
      extraction: parsed.data,
      raw: wire,
      model: VISION_MODEL,
      provider: VISION_PROVIDER,
    };
  }
}

type Wire = z.infer<typeof wireExtractionSchema>;

/** Folds the wire list back into the open statistics record. */
export function fromWire(wire: Wire): unknown {
  const statistics: Record<string, { playerA: number; playerB: number; unit?: string }> = {};
  for (const stat of wire.statistics) {
    const key = stat.key.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) continue;
    statistics[key] = {
      playerA: stat.playerA,
      playerB: stat.playerB,
      ...(stat.unit ? { unit: stat.unit } : {}),
    };
  }

  return {
    validResultScreen: wire.validResultScreen,
    game: wire.game,
    screenType: wire.screenType,
    playerA: wire.playerA,
    playerB: wire.playerB,
    score: { playerA: wire.scoreA, playerB: wire.scoreB },
    penalties:
      wire.penaltiesA !== null && wire.penaltiesB !== null
        ? { playerA: wire.penaltiesA, playerB: wire.penaltiesB }
        : null,
    statistics,
    confidence: {
      overall: clamp01(wire.confidenceOverall),
      score: clamp01(wire.confidenceScore),
      identity: clamp01(wire.confidenceIdentity),
      statistics: clamp01(wire.confidenceStatistics),
    },
    notes: wire.notes,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

let cached: VisionClient | null = null;

/**
 * Returns null when no key is configured. Callers must treat that as
 * "AI unavailable" and park the match in manual review — never as a pass.
 */
export function getVisionClient(): VisionClient | null {
  const apiKey = process.env.AI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!cached) cached = new AnthropicVisionClient(apiKey);
  return cached;
}

/** Test seam. */
export function setVisionClient(client: VisionClient | null): void {
  cached = client;
}
