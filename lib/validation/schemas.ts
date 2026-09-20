import { z } from 'zod';

export const uuid = z.string().uuid();

export const slugSchema = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'الرابط يجب أن يحتوي حروفاً إنجليزية صغيرة وأرقاماً وشرطات');

export const capacitySchema = z.union([z.literal(8), z.literal(16)]);

export const tiebreakerSchema = z.enum([
  'points',
  'goal_difference',
  'goals_for',
  'head_to_head',
  'goals_against',
  'wins',
]);

export const createTournamentSchema = z.object({
  name: z.string().min(3).max(80),
  slug: slugSchema,
  description: z.string().max(2000).optional().nullable(),
  accentColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#E8FF59'),
  capacity: capacitySchema,
  preset: z.enum([
    'league8_double_playoffs',
    'league8_double',
    'knockout8',
    'knockout16',
    'groups_knockout',
    'custom',
  ]),
  visibility: z.enum(['public', 'invite_only']).default('invite_only'),
  platform: z.enum(['ps5', 'ps4', 'xbox', 'pc', 'mobile', 'other']).optional().nullable(),
  prizeInfo: z.string().max(500).optional().nullable(),
  allowedTeams: z.array(z.string().max(60)).max(64).optional().nullable(),
  autoApprove: z.boolean().default(true),
  waitlistEnabled: z.boolean().default(false),
  aiNewsEnabled: z.boolean().default(true),
  aiNewsMode: z.enum(['review_first', 'automatic']).default('review_first'),
  telegramEnabled: z.boolean().default(false),
  registrationOpensAt: z.string().datetime().optional().nullable(),
  registrationClosesAt: z.string().datetime().optional().nullable(),
  checkInOpensAt: z.string().datetime().optional().nullable(),
  checkInClosesAt: z.string().datetime().optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  rules: z
    .object({
      matchDurationMinutes: z.number().int().min(4).max(90).default(15),
      leagueDoubleRound: z.boolean().default(true),
      pointsWin: z.number().int().min(0).max(10).default(3),
      pointsDraw: z.number().int().min(0).max(10).default(1),
      pointsLoss: z.number().int().min(0).max(10).default(0),
      tiebreakers: z.array(tiebreakerSchema).min(1).max(6),
      directSemifinalSlots: z.number().int().min(0).max(8).default(2),
      playoffSlots: z.number().int().min(0).max(16).default(4),
      knockoutTwoLegs: z.boolean().default(true),
      knockoutExtraTime: z.boolean().default(true),
      knockoutPenalties: z.boolean().default(true),
      awayGoalsRule: z.boolean().default(false),
      semifinalDrawMode: z.enum(['seeded', 'open_draw']).default('seeded'),
      thirdPlaceMatch: z.boolean().default(false),
      bigWinGoalDiff: z.number().int().min(1).max(20).default(4),
    })
    .partial()
    .optional(),
});

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;

export const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(40),
  fullName: z.string().max(80).optional().nullable(),
  efootballName: z.string().max(40).optional().nullable(),
  efootballId: z.string().max(40).optional().nullable(),
  platform: z.enum(['ps5', 'ps4', 'xbox', 'pc', 'mobile', 'other']).optional().nullable(),
  phone: z.string().max(24).optional().nullable(),
  telegramUsername: z.string().max(40).optional().nullable(),
  bio: z.string().max(400).optional().nullable(),
  avatarPath: z.string().max(256).optional().nullable(),
});

export const createInviteSchema = z.object({
  tournamentId: uuid,
  label: z.string().max(60).optional().nullable(),
  maxUses: z.number().int().min(1).max(64).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  autoApprove: z.boolean().default(true),
});

export const joinTournamentSchema = z.object({
  tournamentId: uuid,
  inviteToken: z.string().min(16).max(128).optional().nullable(),
});

export const submitEvidenceSchema = z.object({
  matchId: uuid,
  storagePath: z.string().min(8).max(300),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  claimedScoreA: z.number().int().min(0).max(99).optional().nullable(),
  claimedScoreB: z.number().int().min(0).max(99).optional().nullable(),
});

export const adminResolveSchema = z.object({
  matchId: uuid,
  scoreA: z.number().int().min(0).max(99),
  scoreB: z.number().int().min(0).max(99),
  extraTimeA: z.number().int().min(0).max(99).optional().nullable(),
  extraTimeB: z.number().int().min(0).max(99).optional().nullable(),
  penaltiesA: z.number().int().min(0).max(99).optional().nullable(),
  penaltiesB: z.number().int().min(0).max(99).optional().nullable(),
  reason: z.string().min(5).max(500),
});

export const correctionRequestSchema = z.object({
  matchId: uuid,
  reason: z.string().min(5).max(500),
});

export const newsPostSchema = z.object({
  tournamentId: uuid,
  body: z.string().min(1).max(4000),
  mediaPaths: z.array(z.string().max(300)).max(4).optional(),
});

export const chatMessageSchema = z.object({
  roomId: uuid,
  body: z.string().max(2000).optional().nullable(),
  replyToId: uuid.optional().nullable(),
  attachments: z
    .array(
      z.object({
        storagePath: z.string().min(8).max(300),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        byteSize: z.number().int().min(1).max(5 * 1024 * 1024),
        width: z.number().int().positive().optional().nullable(),
        height: z.number().int().positive().optional().nullable(),
      }),
    )
    .max(4)
    .optional(),
});

export const moderationReportSchema = z.object({
  target: z.enum(['news_post', 'chat_message', 'profile']),
  targetId: uuid,
  tournamentId: uuid.optional().nullable(),
  reason: z.string().min(3).max(500),
});

export const transitionSchema = z.object({
  tournamentId: uuid,
  to: z.enum([
    'draft',
    'registration_open',
    'registration_full',
    'check_in',
    'ready_for_draw',
    'league_active',
    'playoffs',
    'semifinal',
    'final',
    'completed',
    'cancelled',
  ]),
});
