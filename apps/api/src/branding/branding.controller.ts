import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UpdateAppBranding, type UpdateAppBranding as UpdateAppBrandingType } from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BrandingService } from './branding.service.js';

/**
 * Branding white-label della web app, per-tenant. Lettura consentita a tutti gli
 * utenti del tenant (serve a ogni pagina); modifica riservata ad ADMIN/OWNER.
 */
@Controller('tenant/branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  get(@CurrentContext() ctx: AuthContext) {
    return this.branding.get(ctx.tenant.tenantId);
  }

  @Put()
  @Roles('ADMIN')
  update(
    @CurrentContext() ctx: AuthContext,
    @Body(new ZodValidationPipe(UpdateAppBranding)) dto: UpdateAppBrandingType,
  ) {
    return this.branding.update(ctx.tenant.tenantId, dto);
  }

  /** Upload del logo o della favicon (multipart, campo "file"). kind: logo|favicon. */
  @Post(':kind')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  upload(
    @CurrentContext() ctx: AuthContext,
    @Param('kind') kind: string,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (kind !== 'logo' && kind !== 'favicon') {
      throw new BadRequestException('Tipo non valido (logo|favicon)');
    }
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    return this.branding.uploadAsset(ctx.tenant.tenantId, kind, {
      mimeType: file.mimetype,
      content: file.buffer,
    });
  }
}
