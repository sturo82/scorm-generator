import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
 * Sotto-brand del tenant (nome visibile + logo). Lettura consentita a tutti gli
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

  /** Upload del logo del tenant (multipart, campo "file"). */
  @Post('logo')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadLogo(
    @CurrentContext() ctx: AuthContext,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (!file) throw new BadRequestException('Nessun file ricevuto (campo "file")');
    return this.branding.uploadAsset(ctx.tenant.tenantId, 'logo', {
      mimeType: file.mimetype,
      content: file.buffer,
    });
  }
}
