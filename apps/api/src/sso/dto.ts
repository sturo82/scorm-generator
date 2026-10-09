import { z } from 'zod';

/**
 * Corpo di POST /sso/ticket (chiamato dalla terza parte con la sua API key).
 * `role` è deciso dalla terza parte ma limitato a maxRole dal server.
 * `externalId` opzionale: identificatore stabile dell'utente presso la terza
 * parte; se assente si usa l'email come chiave.
 */
export const IssueTicketSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(200).optional(),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']).default('VIEWER'),
  externalId: z.string().min(1).max(200).optional(),
});
export type IssueTicketInput = z.infer<typeof IssueTicketSchema>;

/** Corpo di POST /sso/redeem (chiamato dalla web app con il ticket). */
export const RedeemTicketSchema = z.object({
  ticket: z.string().min(1),
});
export type RedeemTicketInput = z.infer<typeof RedeemTicketSchema>;
