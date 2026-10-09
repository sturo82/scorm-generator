# Tasks — Inviti utente da pannello admin (Cognito)

Convenzioni: build/test SEMPRE in container Docker. Dopo ogni fase: build +
suite test verdi. Enforcement ruolo server-side; nessun segreto nel repo.

---

## Fase A — Infrastruttura Cognito (Terraform)

- [ ] 1. Modulo `infra/terraform/cognito.tf`
  - User Pool (`eu-west-1`): sign-in email, password policy, auto-verify email,
    `allow_admin_create_user_only = true`, custom attribute `tenant_id` (String,
    mutable).
  - App Client pubblico (no secret): OAuth code + PKCE, scope openid/email/profile,
    callback/logout URL dal dominio (`var.domain_name`/`app_subdomain`).
  - User Pool Domain (hosted UI).
  - _Requisiti: 1.1, 1.2, 1.3, 1.4, 1.6_

- [ ] 2. IAM + wiring env
  - Policy sul task role: `cognito-idp:AdminCreateUser/AdminDeleteUser/ListUsers`
    ristretta all'ARN dello User Pool.
  - Aggiungi al task API le env: `COGNITO_USER_POOL_ID`, `COGNITO_REGION`,
    `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_TOKEN_USE=access`,
    `OIDC_TENANT_CLAIM=custom:tenant_id`.
  - Output Terraform: issuer, client id, user pool id, hosted domain.
  - _Requisiti: 1.5, 6.1, 6.2_

- [ ] 3. Checkpoint A: `terraform fmt` + `terraform validate` verdi (via Docker).
  - _Requisiti: 7.2_

---

## Fase B — Backend (endpoint + service + test)

- [ ] 4. Dipendenza + config + token DI
  - Aggiungi `@aws-sdk/client-cognito-identity-provider` a `apps/api`.
  - `configuration.ts`: sezione `cognito { userPoolId, region }` da env.
  - `provider.constants.ts`: token `COGNITO_CLIENT`; provider in `admin.module.ts`
    che costruisce il client (o `null` se non configurato).
  - _Requisiti: 6.1_

- [ ] 5. Adapter Cognito `apps/api/src/admin/cognito.ts`
  - Funzioni sottili: `adminCreateUser({ email, tenantId })` → ritorna `{ sub }`;
    `adminDeleteUser(username)`. Incapsula i Command dell'SDK e l'estrazione del
    `sub` dagli attributi.
  - _Requisiti: 2.2, 2.3, 2.6_

- [ ] 6. `AdminUsersService` (`admin-users.service.ts`)
  - `createUser(ctx, dto)`: valida ruolo ≤ chiamante (ROLE_RANK); AdminCreateUser
    con `custom:tenant_id = ctx.tenant.tenantId`; estrai sub; crea `User` via
    `TenantPrismaService.runInTenant`; compensazione AdminDeleteUser se la create
    DB fallisce; audit `user.invited`. Mappa errori (403/409/501/500).
  - `listUsers(ctx)`: utenti del solo `ctx.tenant.tenantId` (filtro esplicito),
    DTO senza segreti.
  - Se Cognito non configurato → `createUser` risponde 501.
  - _Requisiti: 2.1–2.8, 3.1, 3.2, 6.3, 6.4_

- [ ] 7. Endpoint in `AdminController`
  - `@Post('users') @Roles('ADMIN')` (DTO: email valido, role ∈ enum, displayName?)
    e `@Get('users') @Roles('ADMIN')`.
  - _Requisiti: 2.1, 3.1_

- [ ] 8. Test `admin-users.service.test.ts` (Cognito mockato)
  - create ok (attributi + sub + User + audit); ADMIN→OWNER 403; email dup 409;
    compensazione su fallimento DB; tenant preso dal ctx.
  - _Requisiti: 7.1_

- [ ] 9. Checkpoint B: build @scorm/api + suite test verdi in container.
  - _Requisiti: 7.1, 7.2_

---

## Fase C — Frontend (pannello admin)

- [ ] 10. Client + hook
  - `types.ts`: `AdminUserView`, metodi `listUsers()/createUser(input)` in
    `ApiClient`. `http-client.ts` (POST/GET `/admin/users`) + `mock-client.ts`.
  - `hooks.ts`: `qk.users`, `useUsers()`, `useCreateUser()`.
  - _Requisiti: 4.2_

- [ ] 11. Pagina `settings/users`
  - Clona `settings/branding/page.tsx`: tabella utenti + form invito (email,
    displayName, select ruolo filtrato ≤ ruolo corrente). Toast su esito.
  - _Requisiti: 4.1, 4.2, 4.4, 4.5_

- [ ] 12. Voce nav condizionata al ruolo
  - `nav-items.ts`: voce "Utenti"; mostrata solo se ruolo ∈ {OWNER, ADMIN}
    (gating cosmetico).
  - _Requisiti: 4.3_

- [ ] 13. Checkpoint C: typecheck web + lint verdi in container.
  - _Requisiti: 7.2_

---

## Fase D — Seed del primo OWNER + documentazione

- [ ] 14. Script seed `apps/api/scripts/seed-owner.ts`
  - Input via env: `TENANT_ID`, `TENANT_NAME`, `OWNER_SUB`, `OWNER_EMAIL`.
    Crea Plan+Tenant+User OWNER (upsert idempotente).
  - _Requisiti: 5.1, 5.2_

- [ ] 15. Documentazione
  - `DEPLOY-AWS.md`: creare il primo OWNER in Cognito (`AdminCreateUser` +
    `custom:tenant_id=TENANT_ID`), ricavare il `sub`, lanciare il seed; abilitare
    il pannello Utenti; nota GDPR già presente.
  - `.env.example`: `COGNITO_USER_POOL_ID`, `COGNITO_REGION` documentate.
  - _Requisiti: 5.3, 6.1_

- [ ] 16. Checkpoint finale: build completa + suite test + typecheck web + lint
  verdi in container; nessun segreto committato.
  - _Requisiti: 7.1, 7.2, 7.3_
