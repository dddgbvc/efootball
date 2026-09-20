import { z } from 'zod';

/**
 * The contract the vision model must satisfy. Model output is untrusted data
 * until it passes this schema — nothing reaches the database before it does.
 *
 * `statistics` is intentionally an open record so any metric visible on the
 * eFootball result screen can be captured without a schema change. Only its
 * shape is fixed, never the list of keys.
 */
export const statisticPairSchema = z.object({
  playerA: z.number().finite(),
  playerB: z.number().finite(),
  unit: z.string().max(16).optional(),
});

export const sideSchema = z.object({
  name: z.string().max(80).nullable(),
  team: z.string().max(80).nullable(),
  logoDetected: z.boolean().default(false),
  logoDescription: z.string().max(200).nullable().optional(),
});

export const confidenceSchema = z.object({
  overall: z.number().min(0).max(1),
  score: z.number().min(0).max(1),
  identity: z.number().min(0).max(1),
  statistics: z.number().min(0).max(1),
});

export const visionExtractionSchema = z.object({
  validResultScreen: z.boolean(),
  game: z.string().max(40).default('eFootball'),
  screenType: z.string().max(40).nullable().optional(),
  playerA: sideSchema,
  playerB: sideSchema,
  score: z.object({
    playerA: z.number().int().min(0).max(99),
    playerB: z.number().int().min(0).max(99),
  }),
  penalties: z
    .object({
      playerA: z.number().int().min(0).max(99),
      playerB: z.number().int().min(0).max(99),
    })
    .nullable()
    .optional(),
  statistics: z.record(z.string().max(48), statisticPairSchema).default({}),
  confidence: confidenceSchema,
  notes: z.string().max(500).nullable().optional(),
});

export type VisionExtraction = z.infer<typeof visionExtractionSchema>;
export type StatisticPair = z.infer<typeof statisticPairSchema>;

/**
 * The model is told to return exactly this shape. Keeping the prompt's schema
 * and the validator in one file is what stops them drifting apart.
 */
export const EXTRACTION_JSON_CONTRACT = `{
  "validResultScreen": boolean,
  "game": string,
  "screenType": string | null,
  "playerA": { "name": string|null, "team": string|null, "logoDetected": boolean, "logoDescription": string|null },
  "playerB": { "name": string|null, "team": string|null, "logoDetected": boolean, "logoDescription": string|null },
  "score": { "playerA": integer, "playerB": integer },
  "penalties": { "playerA": integer, "playerB": integer } | null,
  "statistics": { "<metric key>": { "playerA": number, "playerB": number, "unit": string? } },
  "confidence": { "overall": 0..1, "score": 0..1, "identity": 0..1, "statistics": 0..1 },
  "notes": string | null
}`;

export function safeParseExtraction(raw: unknown):
  | { ok: true; data: VisionExtraction }
  | { ok: false; issues: string[] } {
  const parsed = visionExtractionSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
  };
}
