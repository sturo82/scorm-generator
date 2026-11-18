import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/public.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SignupService } from './signup.service.js';

const SignupBody = z.object({
  email: z.string().trim().email().max(254),
  captchaToken: z.string().max(4096).optional(),
  /** Campo trappola per i bot: nel form è nascosto e deve restare vuoto. */
  website: z.string().max(200).optional(),
});
type SignupBodyType = z.infer<typeof SignupBody>;

interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

/** IP del client dietro il proxy: l'ultimo valore di X-Forwarded-For lo aggiunge il proxy (il primo può essere falsificato). */
function clientIp(req: IncomingRequest): string {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff.join(',') : (xff ?? '');
  const last = raw.split(',').map((s) => s.trim()).filter(Boolean).pop();
  return last ?? req.ip ?? 'unknown';
}

/** Registrazione pubblica di un account personale. */
@Controller('public')
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  /** Se la registrazione è aperta e quale captcha usare (chiave pubblica). */
  @Public()
  @Get('signup-config')
  config() {
    return this.signup.publicConfig();
  }

  /** Crea l'account personale e invia l'invito. Risposta sempre neutra. */
  @Public()
  @Post('signup')
  async register(@Body(new ZodValidationPipe(SignupBody)) body: SignupBodyType, @Req() req: IncomingRequest) {
    await this.signup.register({ email: body.email, captchaToken: body.captchaToken, honeypot: body.website, ip: clientIp(req) });
    return { ok: true };
  }
}
