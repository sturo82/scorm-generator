import { randomUUID } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUTH_CONTEXT_KEY, type AuthContext } from '../auth/auth-context.js';

interface RequestLike {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  [AUTH_CONTEXT_KEY]?: AuthContext;
}

/**
 * Interceptor di logging strutturato con correlation id end-to-end
 * (Requisito 11.2). Garantisce la presenza di un correlation id (dall'header
 * x-correlation-id o generato), lo rende disponibile sulla request e logga esito
 * e durata di ogni chiamata in formato strutturato (JSON-friendly).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestLike>();
    const correlationId = this.ensureCorrelationId(req);
    const start = Date.now();
    const method = req.method ?? '';
    const url = req.url ?? '';

    return next.handle().pipe(
      tap({
        next: () => this.log('ok', method, url, correlationId, start, req),
        error: (err) => this.log('error', method, url, correlationId, start, req, err),
      }),
    );
  }

  private ensureCorrelationId(req: RequestLike): string {
    const header = req.headers['x-correlation-id'];
    const existing = Array.isArray(header) ? header[0] : header;
    const id = existing && existing.length > 0 ? existing : randomUUID();
    req.headers['x-correlation-id'] = id;
    return id;
  }

  private log(
    outcome: 'ok' | 'error',
    method: string,
    url: string,
    correlationId: string,
    start: number,
    req: RequestLike,
    err?: unknown,
  ): void {
    const entry = {
      outcome,
      method,
      url,
      correlationId,
      tenantId: req[AUTH_CONTEXT_KEY]?.tenant.tenantId,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : undefined,
    };
    const line = JSON.stringify(entry);
    if (outcome === 'error') this.logger.error(line);
    else this.logger.log(line);
  }
}
