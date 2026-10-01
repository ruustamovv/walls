/**
 * Server-side account preferences validation.
 */
import { z } from 'zod';

export const SettingsSchema = z.object({
  showRating: z.boolean().optional(),
  allowChallenges: z.boolean().optional(),
  chatScope: z.enum(['everyone', 'friends', 'nobody']).optional(),
  profileVisibility: z.enum(['public', 'friends', 'private']).optional(),
  historyVisibility: z.enum(['public', 'friends', 'private']).optional(),
  notifyMatches: z.boolean().optional(),
  notifyResults: z.boolean().optional(),
});

export type SettingsInput = z.infer<typeof SettingsSchema>;
