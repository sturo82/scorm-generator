/**
 * Scope multi-tenant propagato a tutte le operazioni infrastrutturali.
 * Garantisce l'isolamento dei dati per tenant (Requisito 1.2): ogni adapter
 * deve filtrare/namespacing in base a questo scope.
 */
export interface TenantScope {
  tenantId: string;
  /** Facoltativo: restringe ulteriormente a un corso (knowledge per-corso). */
  courseId?: string;
}

/** Identificatore di correlazione per log e tracciabilità (Requisito 11.2). */
export interface RequestContext {
  tenant: TenantScope;
  correlationId: string;
  userId?: string;
}
