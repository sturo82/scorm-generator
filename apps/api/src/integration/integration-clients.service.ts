import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ServiceTokenService } from './service-token.service.js';
import {
  ALL_INTEGRATION_SCOPES,
  DEFAULT_INTEGRATION_SCOPES,
  type IntegrationScope,
} from './integration-scopes.js';

/** Vista di un client di integrazione (senza mai il secret in chiaro). */
export interface IntegrationClientView {
  id: string;
  name: string;
  clientId: string;
  scopes: string[];
  status: 'ACTIVE' | 'REVOKED';
  lastUsedAt: string | null;
  createdAt: string;
}

/** Risultato della creazione: include il secret UNA SOLA VOLTA. */
export interface IntegrationClientCreated extends IntegrationClientView {
  /** Secret in chiaro, mostrato solo alla creazione: va copiato subito. */
  clientSecret: string;
}

/** Esito di un token client-credentials. */
export interface TokenResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresInSec: number;
  scopes: string[];
}

/**
 * Gestione dei client di integrazione (lato tenant) e del flusso OAuth2
 * client-credentials (lato terze parti).
 */
@Injectable()
export class IntegrationClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: ServiceTokenService,
  ) {}

  /** Crea un client per il tenant; ritorna il secret una sola volta. */
  async create(
    tenantId: string,
    input: { name: string; scopes?: string[] },
  ): Promise<IntegrationClientCreated> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Nome del client obbligatorio');

    const scopes = this.validateScopes(input.scopes);
    const clientId = this.tokens.generateClientId();
    const clientSecret = this.tokens.generateClientSecret();
    const secretHash = await this.tokens.hashSecret(clientSecret);

    const row = await this.prisma.integrationClient.create({
      data: { tenantId, name, clientId, secretHash, scopes, status: 'ACTIVE' },
    });

    return { ...this.toView(row), clientSecret };
  }

  async list(tenantId: string): Promise<IntegrationClientView[]> {
    const rows = await this.prisma.integrationClient.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  /** Revoca (soft): il client resta per storico ma non emette più token. */
  async revoke(tenantId: string, id: string): Promise<IntegrationClientView> {
    const row = await this.prisma.integrationClient.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Client non trovato');
    const updated = await this.prisma.integrationClient.update({
      where: { id: row.id },
      data: { status: 'REVOKED' },
    });
    return this.toView(updated);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const row = await this.prisma.integrationClient.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Client non trovato');
    await this.prisma.integrationClient.delete({ where: { id: row.id } });
  }

  /**
   * Flusso client-credentials: valida clientId/clientSecret, verifica lo stato
   * ACTIVE ed emette un access token di servizio con gli scopi del client.
   * Errori volutamente generici (nessun oracolo su quale credenziale è errata).
   */
  async issueToken(clientId: string, clientSecret: string): Promise<TokenResult> {
    if (!clientId || !clientSecret) {
      throw new UnauthorizedException('Credenziali client mancanti');
    }
    const client = await this.prisma.integrationClient.findUnique({ where: { clientId } });
    // Verifica il secret anche se il client non esiste, per non rivelare per
    // timing l'esistenza del clientId (si confronta con un hash fittizio).
    const stored = client?.secretHash ?? DUMMY_HASH;
    const ok = await this.tokens.verifySecret(clientSecret, stored);
    if (!client || client.status !== 'ACTIVE' || !ok) {
      throw new UnauthorizedException('Credenziali client non valide');
    }

    const { accessToken, expiresInSec } = this.tokens.sign({
      clientId: client.clientId,
      tenantId: client.tenantId,
      scopes: client.scopes,
    });

    // Best-effort: aggiorna l'ultimo utilizzo per audit (non blocca l'emissione).
    await this.prisma.integrationClient
      .update({ where: { id: client.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSec,
      scopes: client.scopes,
    };
  }

  private validateScopes(scopes?: string[]): IntegrationScope[] {
    if (!scopes || scopes.length === 0) return [...DEFAULT_INTEGRATION_SCOPES];
    const invalid = scopes.filter(
      (s) => !ALL_INTEGRATION_SCOPES.includes(s as IntegrationScope),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(`Scopi non riconosciuti: ${invalid.join(', ')}`);
    }
    // Dedup preservando l'ordine canonico.
    return ALL_INTEGRATION_SCOPES.filter((s) => scopes.includes(s));
  }

  private toView(row: {
    id: string;
    name: string;
    clientId: string;
    scopes: string[];
    status: 'ACTIVE' | 'REVOKED';
    lastUsedAt: Date | null;
    createdAt: Date;
  }): IntegrationClientView {
    return {
      id: row.id,
      name: row.name,
      clientId: row.clientId,
      scopes: row.scopes,
      status: row.status,
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/**
 * Hash fittizio (formato scrypt valido ma di secret casuale) usato quando il
 * clientId non esiste: così `verifySecret` svolge comunque il lavoro crittografico
 * e il tempo di risposta non rivela l'esistenza del client.
 */
const DUMMY_HASH =
  'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
