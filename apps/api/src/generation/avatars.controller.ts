import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { MediaService } from './media.service.js';

/** Dati per creare un avatar da PROMPT (il tipo "photo" usa il multipart). */
class CreatePromptAvatarDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  prompt!: string;
}

/**
 * Gestione degli avatar HeyGen DEL TENANT (sezione Impostazioni → Avatar).
 * Creazione/eliminazione a pagamento (una tantum) riservate ad ADMIN/OWNER;
 * lettura della lista consentita agli autori (serve nell'editor video).
 *
 * Non è legato a un corso: gli avatar vivono a livello di account HeyGen e
 * sono condivisi tra tutti i corsi del tenant.
 */
@Controller('tenant/avatars')
export class AvatarsController {
  constructor(private readonly media: MediaService) {}

  /** Elenca gli avatar dell'account (i "miei"). `q` cerca per nome; `refresh=true` bypassa la cache. */
  @Get()
  list(@Query('q') q?: string, @Query('refresh') refresh?: string) {
    return this.media.listMyAvatars(q, refresh === 'true');
  }

  /** Stato di un look avatar in creazione (polling dopo la creazione). */
  @Get('looks/:lookId')
  getLook(@Param('lookId') lookId: string) {
    return this.media.getAvatarLook(lookId);
  }

  /**
   * Crea un avatar da FOTO (multipart, campo "file" + "name"). A pagamento una
   * tantum. Asincrono: ritorna il look in stato 'processing' + gli engine
   * supportati; usare GET looks/:lookId per attendere 'completed'.
   */
  @Post('photo')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 32 * 1024 * 1024 } }))
  createPhoto(
    @CurrentContext() ctx: AuthContext,
    @Body('name') name: string | undefined,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (!file) throw new BadRequestException('Nessuna immagine ricevuta (campo "file")');
    if (!name?.trim()) throw new BadRequestException('Nome avatar mancante (campo "name")');
    return this.media.createAvatar(ctx.tenant.tenantId, {
      type: 'photo',
      name: name.trim(),
      image: { bytes: file.buffer, contentType: file.mimetype },
    });
  }

  /**
   * Crea un avatar da PROMPT (JSON: name + prompt). A pagamento una tantum.
   * Asincrono: come la creazione da foto.
   */
  @Post('prompt')
  @Roles('ADMIN')
  createPrompt(@CurrentContext() ctx: AuthContext, @Body() dto: CreatePromptAvatarDto) {
    return this.media.createAvatar(ctx.tenant.tenantId, {
      type: 'prompt',
      name: dto.name,
      prompt: dto.prompt,
    });
  }

  /** Elimina un avatar del tenant (per groupId). Non rimborsa il costo. */
  @Delete(':groupId')
  @Roles('ADMIN')
  remove(@CurrentContext() ctx: AuthContext, @Param('groupId') groupId: string) {
    return this.media.deleteAvatar(ctx.tenant.tenantId, groupId);
  }
}
