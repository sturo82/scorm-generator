import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { EcosystemHttpService, EcosystemRequestError } from '../ecosystem/ecosystem-http.service.js';
import { EcosystemSettingsService } from '../ecosystem/ecosystem-settings.service.js';
import { SlidingWindowLimiter } from './signup-limiter.js';

const HOUR = 60 * 60 * 1000;

interface ManagerError {
  error?: string;
}

/**
 * Registrazione di un utente personale (senza company). La crea Manager: utente nel pool senza
 * `custom:tenant_id` e con `custom:role = PERSONAL`, email d'invito con password temporanea e wallet
 * personale pronto. K Scorm non salva nulla qui: lo spazio personale nasce al primo accesso.
 *
 * Difese: honeypot, captcha (Turnstile, se configurato), limiti per IP, per email e globale. La
 * risposta è sempre neutra: non rivela se un'email esiste già.
 */
@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);
  private readonly byIp = new SlidingWindowLimiter(5, HOUR);
  private readonly byEmail = new SlidingWindowLimiter(3, HOUR);
  private readonly global = new SlidingWindowLimiter(200, HOUR);
  private readonly cfg: AppConfig['signup'];
  private readonly personalSpaceEnabled: boolean;
  private readonly productKey: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly http: EcosystemHttpService,
    private readonly settings: EcosystemSettingsService,
  ) {
    this.cfg = config.get('signup', { infer: true });
    this.personalSpaceEnabled = config.get('auth', { infer: true }).personalSpaceEnabled;
    this.productKey = config.get('ecosystem', { infer: true }).productKey;
  }

  /** La registrazione è disponibile solo con lo spazio personale acceso e il wallet attivo. */
  isEnabled(): boolean {
    return this.personalSpaceEnabled && this.settings.walletEnabled;
  }

  publicConfig(): { enabled: boolean; captcha: { provider: 'turnstile'; siteKey: string } | null } {
    return {
      enabled: this.isEnabled(),
      captcha: this.cfg.turnstileSiteKey && this.cfg.turnstileSecret ? { provider: 'turnstile', siteKey: this.cfg.turnstileSiteKey } : null,
    };
  }

  async register(input: { email: string; captchaToken?: string; honeypot?: string; ip: string }): Promise<void> {
    if (!this.isEnabled()) throw new NotFoundException();
    // Un bot compila il campo trappola: si risponde come se fosse andato bene, senza fare nulla.
    if (input.honeypot && input.honeypot.trim().length > 0) return;
    const email = input.email.trim().toLowerCase();
    if (!this.global.allow('all') || !this.byIp.allow(input.ip) || !this.byEmail.allow(email)) {
      throw new HttpException(
        { error: 'rate_limited', message: 'Troppe richieste: riprova più tardi.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.verifyCaptcha(input.captchaToken, input.ip);
    try {
      const res = await this.http.post<{ status?: string }>('users/personal', { product: this.productKey, email });
      this.logger.log(`Registrazione personale: ${res?.status ?? 'ok'}`);
    } catch (err) {
      if (!(err instanceof EcosystemRequestError)) throw this.unavailable();
      const code = (err.body as ManagerError | undefined)?.error;
      // L'email appartiene a un utente aziendale: risposta neutra (non si rivela che esiste).
      if (err.status === 409 && code === 'user_exists') return;
      if (err.status === 400 && code === 'invalid_email') {
        throw new HttpException({ error: 'invalid_email', message: 'Indirizzo email non valido.' }, HttpStatus.BAD_REQUEST);
      }
      if (err.status === 429) {
        throw new HttpException(
          { error: 'rate_limited', message: 'Troppe richieste: riprova più tardi.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (code === 'invite_email_failed') {
        // L'account esiste ma l'email non è partita: richiamando lo stesso endpoint si reinvia.
        throw new HttpException(
          { error: 'invite_email_failed', message: "Non siamo riusciti a inviare l'email: riprova tra poco." },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      this.logger.error(`Registrazione personale non riuscita: HTTP ${err.status ?? 'n/d'} ${code ?? ''}`);
      throw this.unavailable();
    }
  }

  private unavailable(): HttpException {
    return new HttpException(
      { error: 'signup_unavailable', message: 'Registrazione momentaneamente non disponibile: riprova più tardi.' },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /** Verifica il captcha Turnstile se configurato; senza configurazione la registrazione si apre con i soli limiti. */
  private async verifyCaptcha(token: string | undefined, ip: string): Promise<void> {
    if (!this.cfg.turnstileSecret) return;
    let ok = false;
    if (token) {
      try {
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          body: new URLSearchParams({ secret: this.cfg.turnstileSecret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(8000),
        });
        ok = ((await res.json()) as { success?: boolean }).success === true;
      } catch (err) {
        this.logger.warn(`Verifica captcha non riuscita: ${err instanceof Error ? err.message : 'errore'}`);
      }
    }
    if (!ok) {
      throw new HttpException(
        { error: 'captcha_failed', message: 'Verifica anti-spam non riuscita: riprova.' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
