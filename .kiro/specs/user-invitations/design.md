# Design — Inviti utente da pannello admin (Cognito)

## Panoramica

Tre layer, coerenti con il codebase esistente:

1. **Infra (Terraform)**: Cognito User Pool + App Client + custom attribute
   `tenant_id`, self-signup off. Output per API e Web.
2. **Backend (NestJS)**: `AdminUsersService` + endpoint in `AdminController`
   (`POST /admin/users`, `GET /admin/users`). Il service orchestra Cognito
   (`AdminCreateUser`) + Prisma (record `User`), con compensazione e audit.
3. **Frontend (Next.js)**: pagina `settings/users` (elenco + form invito),
   metodi client/hook, voce nav condizionata al ruolo.

```
Admin UI (settings/users)
   │  POST /admin/users { email, displayName, role }
   ▼
AdminController @Roles('ADMIN')  ──►  AdminUsersService
                                        1. valida ruolo ≤ chiamante
                                        2. Cognito.AdminCreateUser(custom:tenant_id)
                                        3. estrai sub
                                        4. prisma.user.create (nel tenant corrente)
                                        5. se (4) fallisce → Cognito.AdminDeleteUser (compensazione)
                                        6. audit 'user.invited'
```

## Decisioni di design

### Perché la compensazione (non una transazione distribuita)
Cognito e Postgres sono due sistemi distinti: non esiste una transazione atomica
tra loro. L'ordine è **prima Cognito, poi DB**, perché il `sub` lo genera Cognito
ed è la chiave (`externalId`) del record `User`. Se il DB fallisce dopo la
creazione Cognito, compensiamo con `AdminDeleteUser`. L'inverso (prima DB poi
Cognito) non è possibile: non avremmo il `sub`.

Rischio residuo onesto: se la compensazione `AdminDeleteUser` fallisce (es. rete),
resta un utente Cognito orfano (esiste in Cognito, non nel DB → non può loggare).
Mitigazione: logghiamo l'incongruenza come errore con l'email, così è
rimediabile a mano; è un caso raro e non lascia accessi impropri.

### Gerarchia dei ruoli nell'assegnazione
Riuso `ROLE_RANK` (OWNER:3, ADMIN:2, EDITOR:1, VIEWER:0) già in `roles.guard.ts`.
Il service verifica `rank(roleRichiesto) <= rank(ruoloChiamante)`; altrimenti
403. Così un ADMIN può creare ADMIN/EDITOR/VIEWER ma non OWNER.

### Isolamento tenant sulla scrittura
I servizi esistenti usano `PrismaService` + filtro esplicito `tenantId` (il
`TenantPrismaService.runInTenant` esiste ma non è usato). Per la **creazione di
un `User`** (scrittura sensibile su una tabella con RLS) adottiamo
`TenantPrismaService.runInTenant(ctx.tenant.tenantId, (tx) => tx.user.create(...))`,
così la GUC `app.current_tenant` è impostata e la policy RLS `WITH CHECK` è
soddisfatta anche se in futuro l'app girasse con un ruolo DB non-BYPASSRLS. Per
la lettura (`GET`) usiamo il filtro esplicito `where: { tenantId }` come il resto
del codice. Il `tenantId` viene SEMPRE da `ctx.tenant.tenantId` (mai dall'input):
impossibile creare/elencare utenti di altri tenant.

### Client Cognito come provider DI
Aggiungo `@aws-sdk/client-cognito-identity-provider`. Il client è un provider
NestJS (token `COGNITO_CLIENT`) costruito dalla config, così è mockabile nei
test. Nessuna credenziale esplicita: in prod le fornisce il task role IAM
(default credential chain); in locale/test il client è mockato e non parte.

### Config
Nuovi campi in `configuration.ts`: `cognito.userPoolId`, `cognito.region`
(default = regione AWS). Env: `COGNITO_USER_POOL_ID`, `COGNITO_REGION`. Se
`COGNITO_USER_POOL_ID` è assente (dev/test), il service di inviti è
**disabilitato** e l'endpoint risponde 501/"non configurato" invece di crashare —
così dev con `AUTH_PROVIDER=dev` non richiede Cognito.

## Componenti e interfacce

### Backend (apps/api/src/admin/)
- `admin-users.service.ts` — `AdminUsersService`:
  - `createUser(ctx, { email, displayName?, role }): Promise<UserView>`
  - `listUsers(ctx): Promise<UserView[]>`
  - dipendenze: `COGNITO_CLIENT`, `PrismaService`, `TenantPrismaService`,
    `AuditService`, `ConfigService`.
- `admin.controller.ts` — aggiunti:
  - `@Post('users') @Roles('ADMIN')` con DTO validato (class-validator:
    `@IsEmail`, `@IsIn([...ruoli])`, `displayName?`).
  - `@Get('users') @Roles('ADMIN')`.
- `admin.module.ts` — registra `AdminUsersService` + provider `COGNITO_CLIENT`.
- `cognito.ts` (adapter sottile) — incapsula `AdminCreateUserCommand`,
  `AdminDeleteUserCommand`; estrae il `sub` dagli attributi della response.
- Config: `configuration.ts` + `provider.constants.ts` (token `COGNITO_CLIENT`).

`UserView` (DTO di risposta): `{ id, email, displayName, role, createdAt }`.
Nessun segreto.

### Frontend (apps/web/src/)
- `app/(app)/settings/users/page.tsx` — clona `settings/branding/page.tsx`:
  tabella utenti + form invito (email, displayName, select ruolo filtrato).
- `lib/api/types.ts` — `AdminUserView`, metodi `listUsers()/createUser(input)`
  nell'interfaccia `ApiClient`.
- `lib/api/http-client.ts` + `mock-client.ts` — implementazioni.
- `lib/api/hooks.ts` — `qk.users`, `useUsers()`, `useCreateUser()`.
- `components/app/nav-items.ts` — voce `{ href:'/settings/users', label:'Utenti' }`.
  Il rendering della voce è condizionato a `getSession()?.user.role ∈ {OWNER,ADMIN}`
  (gating cosmetico; l'enforcement è server-side).

### Infra (infra/terraform/cognito.tf)
- `aws_cognito_user_pool`: `username_attributes=["email"]`,
  `admin_create_user_config.allow_admin_create_user_only=true`, password policy,
  `schema` con custom attribute `tenant_id` (String, mutable),
  `auto_verified_attributes=["email"]`.
- `aws_cognito_user_pool_client`: public (no secret),
  `explicit_auth_flows` adeguati, `allowed_oauth_flows=["code"]`,
  `allowed_oauth_scopes=["openid","email","profile"]`, callback URL dal dominio,
  `supported_identity_providers=["COGNITO"]`.
- `aws_cognito_user_pool_domain`: hosted UI domain.
- IAM: policy sul task role per `cognito-idp:AdminCreateUser/AdminDeleteUser/ListUsers`
  ristretta all'ARN dello User Pool.
- Output: `cognito_issuer`, `cognito_client_id`, `cognito_user_pool_id`,
  `cognito_hosted_domain`. Collego anche le env del task API
  (`COGNITO_USER_POOL_ID`, `COGNITO_REGION`, `OIDC_ISSUER`, `OIDC_AUDIENCE`,
  `OIDC_TOKEN_USE=access`, `OIDC_TENANT_CLAIM=custom:tenant_id`).

### Seed del primo tenant/OWNER (apps/api/scripts/)
- Script `seed-owner.ts` (eseguito come task one-off, immagine già disponibile):
  input `TENANT_ID`, `TENANT_NAME`, `OWNER_SUB` (il `sub` Cognito dell'operatore),
  `OWNER_EMAIL`. Crea Plan (ENTERPRISE) se assente, Tenant con `id=TENANT_ID`,
  User OWNER (`externalId=OWNER_SUB`). Idempotente (upsert).
- Il `TENANT_ID` scelto qui è lo stesso valore da mettere in `custom:tenant_id`
  per ogni utente invitato (il service lo prende da `ctx`, quindi dopo il seed è
  automatico).
- Documentato in `DEPLOY-AWS.md`: come creare in Cognito il primo OWNER
  (`AdminCreateUser` + `custom:tenant_id=TENANT_ID`), ricavarne il `sub`, e
  lanciare il seed.

## Gestione errori (mappatura HTTP)
- Ruolo richiesto > chiamante → `403 ForbiddenException`.
- Email già esistente nel tenant (Prisma `P2002` o Cognito `UsernameExists`) →
  `409 ConflictException`, nessun duplicato, nessuna email inviata due volte.
- Cognito non configurato (no `COGNITO_USER_POOL_ID`) → `501`/messaggio chiaro.
- Fallimento DB post-Cognito → compensazione `AdminDeleteUser`, poi `500` con
  messaggio generico; incongruenza loggata se anche la compensazione fallisce.

## Testing
- Unit `admin-users.service.test.ts` con **Cognito client mockato**:
  - crea utente: chiama AdminCreateUser con `custom:tenant_id` del ctx, estrae
    sub, crea `User`, audit chiamato.
  - gerarchia ruoli: ADMIN che crea OWNER → 403.
  - email duplicata → 409 (simula P2002 / UsernameExists).
  - compensazione: DB fallisce → AdminDeleteUser invocato.
  - tenant: `tenantId` preso dal ctx, mai dall'input.
- La suite esistente resta verde; nessun test richiede Cognito reale.
- Verifica in container Docker.

## Strategia a fasi
- **Fase A — Infra**: `cognito.tf` + output + IAM + wiring env nel task API.
  Validazione `terraform validate`.
- **Fase B — Backend**: dipendenza AWS SDK, config, adapter Cognito, service,
  endpoint, test. Build + test verdi.
- **Fase C — Frontend**: client/hook, pagina `settings/users`, voce nav. Typecheck
  web + lint.
- **Fase D — Seed & docs**: script seed + aggiornamento `DEPLOY-AWS.md` e
  `.env.example`. Verifica finale.

## Rischi e mitigazioni
1. **Stato incoerente Cognito↔DB** → ordine Cognito-first + compensazione + log.
2. **RLS su User**: la create via `runInTenant` evita sorprese se il ruolo DB
   cambiasse; coerente con l'intento della migrazione 0002.
3. **Dev senza Cognito**: service disabilitato se non configurato → nessun crash
   in `AUTH_PROVIDER=dev`.
4. **Ruolo nei claim**: il frontend legge il ruolo dalla sessione (cosmetico);
   l'autorizzazione reale è `@Roles` server-side.
5. **Dipendenza AWS SDK aggiuntiva**: isolata nell'adapter; non impatta altri moduli.
