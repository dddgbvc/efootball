import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { ClassifiedEvent } from '@/lib/news/classify';

export const REPORTER_MODEL = 'claude-opus-5';

const articleSchema = z.object({
  headline: z.string().describe('عنوان قصير وقوي بالعربية، بحد أقصى 70 حرفاً'),
  body: z.string().describe('خبر رياضي من فقرة إلى فقرتين بالعربية'),
});

export type ReporterArticle = z.infer<typeof articleSchema>;

const SYSTEM_PROMPT = `أنت محرر رياضي عربي يغطي بطولات eFootball.

تكتب خبراً قصيراً وقوياً اعتماداً **فقط** على الوقائع المنظمة التي تصلك. هذه الوقائع رسمية وموثقة.

القواعد الصارمة:
- لا تخترع أي رقم أو اسم أو حدث غير موجود في الوقائع.
- لا تصف المباراة بأنها "اكتساح" إلا إذا كان eventType هو BIG_WIN.
- لا تتحدث عن "ريمونتادا" أو "انقلاب في النتيجة" إلا إذا دلّت الوقائع على ذلك صراحة.
- لا إهانات شخصية ولا تهديد ولا تحقير خارج نطاق النتيجة الرياضية. المنافسة والحماس مقبولان.
- اللغة: عربية فصحى رياضية، حيوية، متنوعة، مختصرة.
- لا تذكر أنك ذكاء اصطناعي.

أمثلة على المفردات المسموحة: اكتساح، تفوق، حسم، قمة الجولة، مواجهة مثيرة، تعادل دراماتيكي، انتصار عريض، صدارة، تأهل، نقاط ثمينة.`;

export interface ReporterOutcome {
  ok: boolean;
  article?: ReporterArticle;
  error?: string;
}

export interface ReporterClient {
  write(event: ClassifiedEvent): Promise<ReporterOutcome>;
}

class AnthropicReporter implements ReporterClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async write(event: ClassifiedEvent): Promise<ReporterOutcome> {
    try {
      const response = await this.client.messages.parse({
        model: REPORTER_MODEL,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(articleSchema), effort: 'low' },
        messages: [
          {
            role: 'user',
            content: `اكتب خبراً عن هذا الحدث الرسمي:\n\n${JSON.stringify(event.facts, null, 2)}`,
          },
        ],
      });

      if (response.stop_reason === 'refusal') {
        return { ok: false, error: `refusal: ${response.stop_details?.category ?? 'unknown'}` };
      }

      const parsed = response.parsed_output;
      if (!parsed) return { ok: false, error: 'no parsable output' };

      return { ok: true, article: parsed };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * Deterministic copy used when the model is unavailable. The feed still tells
 * the truth; it just does it plainly. Nothing here is ever invented — every
 * value comes from the classified facts.
 */
export function fallbackArticle(event: ClassifiedEvent): ReporterArticle {
  const f = event.facts as Record<string, never> & {
    winner?: string;
    loser?: string;
    tournament?: string;
    champion?: string;
    players?: { playerA: { name: string }; playerB: { name: string } };
    score?: { winner?: number; loser?: number; playerA?: number; playerB?: number };
  };

  switch (event.eventType) {
    case 'CHAMPION':
      return {
        headline: `🏆 ${f.champion} بطلاً`,
        body: `توّج ${f.champion} بلقب ${f.tournament} بعد اكتمال جميع مراحل البطولة.`,
      };
    case 'BIG_WIN':
      return {
        headline: `🔥 انتصار عريض لـ ${f.winner}`,
        body: `حسم ${f.winner} المواجهة أمام ${f.loser} بنتيجة ${f.score?.winner}–${f.score?.loser}.`,
      };
    case 'DRAMATIC_DRAW':
      return {
        headline: '⚡ تعادل مثير',
        body: `انتهت مواجهة ${f.players?.playerA.name} و${f.players?.playerB.name} بالتعادل ${f.score?.playerA}–${f.score?.playerB}.`,
      };
    default:
      if (f.winner) {
        return {
          headline: `${f.winner} يحسم مباراته`,
          body: `تغلّب ${f.winner} على ${f.loser} بنتيجة ${f.score?.winner}–${f.score?.loser} في ${f.tournament}.`,
        };
      }
      return {
        headline: 'تحديث من البطولة',
        body: `تم اعتماد نتيجة جديدة في ${f.tournament}.`,
      };
  }
}

let cached: ReporterClient | null = null;

export function getReporterClient(): ReporterClient | null {
  const apiKey = process.env.AI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!cached) cached = new AnthropicReporter(apiKey);
  return cached;
}

export function setReporterClient(client: ReporterClient | null): void {
  cached = client;
}
