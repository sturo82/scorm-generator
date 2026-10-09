import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantPrismaService } from '../tenancy/tenant-prisma.service.js';
import { AuditService } from '../observability/audit.service.js';
import { COGNITO_CLIENT } from '../providers/provider.constants.js';
import type { AuthContext } from '../auth/auth-context.js';
import { adminCreateUser, adminDeleteUser, CognitoUserExistsError } from './cognito.js';

/** Gerarchia ruoli (coerente con roles.guard): OWNER ⊇ ADMIN ⊇ EDITOR ⊇ VIEWER. */
const ROLE_RANK: Record<UserRole, number> = { OWNER: 3, ADMIN: 2, EDITOR: 1, VIEWER: 0 };

export interface CreateUserInput {
  email: string;
  displayName?: string;
  role: UserRole;
}

/** Vista pubblica di un utente (nessun segreto). */
export interface AdminUserView {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  createdAt: string;
}

/**
 * Gestione utenti lato admin: invita (crea in Cognito + record DB) ed elenca gli
 * utenti del tenant corrente. Il tenant proviene SEMPRE da ctx (mai dall'input),
 * così non è possibile toccare altri tenant. Il ruolo assegnabile non può
 * superare quello del chiamante. Se Cognito non è configurato, l'invito è
 * disabilitato (501) — utile in dev/test.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
    @Optional() @Inject(COGNITO_CLIENT) private readonly cognito: CognitoIdentityProviderClient | null,
  ) {}

  async createUser(ctx: AuthContext, input: CreateUserInput): Promise<AdminUserView> {
    const cognitoCfg = this.config.get('cognito', { infer: true });
    if (!this.cognito || !cognitoCfg.userPoolId) {
      throw new NotImplementedException(
        'Gestione utenti non configurata (Cognito assente in questo ambiente)',
      );
    }

    // Un utente non può creare un ruolo superiore al proprio.
    if (ROLE_RANK[input.role] > ROLE_RANK[ctx.role]) {
      throw new ForbiddenException('Non puoi assegnare un ruolo superiore al tuo');
    }

    const tenantId = ctx.tenant.tenantId;
    const email = input.email.trim().toLowerCase();
    const userPoolId = cognitoCfg.userPoolId;

    // 1) Crea in Cognito (genera il sub, invia l'email d'invito).
    let sub: string;
    try {
      ({ sub } = await adminCreateUser(this.cognito, { userPoolId, email, tenantId }));
    } catch (err) {
      if (err instanceof CognitoUserExistsError) {
        throw new ConflictException('Esiste già un utente con questa email');
      }
      throw err;
    }

    // 2) Crea il record DB nel contesto del tenant (RLS). Se fallisce,
    //    COMPENSA eliminando l'utente Cognito.
    try {
      const created = await this.tenantPrisma.runInTenant(tenantId, (tx) =>
        tx.user.create({
          data: { tenantId, externalId: sub, email, displayName: input.displayName, role: input.role },
          select: { id: true, email: true, displayName: true, role: true, createdAt: true },
        }),
      );
      await this.audit.record(ctx, {
        action: 'user.invited',
        resourceType: 'user',
        resourceId: created.id,
        metadata: { email, role: input.role },
      });
      return { ...created, createdAt: created.createdAt.toISOString() };
    } catch (err) {
      // Compensazione best-effort.
      try {
        await adminDeleteUser(this.cognito, userPoolId, email);
      } catch (cleanupErr) {
        // Incongruenza: utente Cognito orfano. Logga per rimedio manuale.
        this.logger.error(
          `Compensazione Cognito fallita per ${email}: resta un utente orfano. ${
            cleanupErr instanceof Error ? cleanupErr.message : ''
          }`,
        );
      }
      // Email duplicata nel tenant (vincolo @@unique([tenantId, email])).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Esiste già un utente con questa email');
      }
      throw err;
    }
  }

  /** Elenco utenti del SOLO tenant del chiamante (nessun segreto). */
  async listUsers(ctx: AuthContext): Promise<AdminUserView[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId: ctx.tenant.tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
    });
    return rows.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }));
  }
}
