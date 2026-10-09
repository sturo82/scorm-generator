import { z } from 'zod';

/** Corpo di POST /oauth/token (client_credentials). */
export const TokenRequestSchema = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});
export type TokenRequest = z.infer<typeof TokenRequestSchema>;

/** Creazione di un client di integrazione (lato tenant). */
export const CreateIntegrationClientSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string()).optional(),
});
export type CreateIntegrationClient = z.infer<typeof CreateIntegrationClientSchema>;

/** Query opzionali per il download di un pacchetto dal catalogo. */
export const DownloadQuerySchema = z.object({
  profile: z.enum(['SCORM_2004_4TH', 'SCORM_12']).optional(),
  brandId: z.string().optional(),
});
export type DownloadQuery = z.infer<typeof DownloadQuerySchema>;
