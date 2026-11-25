import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { MediaService } from './media.service.js';
import { AvatarAccessService } from './avatar-access.service.js';

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

/** Nuova assegnazione di un avatar. */
class AssignAvatarDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  userIds!: string[];
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
  constructor(
    private readonly media: MediaService,
    private readonly access: AvatarAccessService,
  ) {}

  private viewer(ctx: AuthContext) {
    return { tenantId: ctx.tenant.tenantId, userId: ctx.userId, role: ctx.role };
  }

  /** I digital twin si creano solo dagli utenti dell'azienda della piattaforma (Knowkube). */
  private assertCanCreateTwin(ctx: AuthContext): void {
    if (!this.access.isPlatform(this.viewer(ctx))) {
      throw new ForbiddenException('La creazione di digital twin è riservata agli utenti Knowkube.');
    }
  }

  /** Cosa può creare l'utente corrente (la pagina Avatar mostra solo le opzioni consentite). */
  @Get('capabilities')
  capabilities(@CurrentContext() ctx: AuthContext) {
    return { canCreateTwin: this.access.isPlatform(this.viewer(ctx)) };
  }

  /** Elenca gli avatar dell'account (i "miei"). `q` cerca per nome; `refresh=true` bypassa la cache. */
  @Get()
  list(@CurrentContext() ctx: AuthContext, @Query('q') q?: string, @Query('refresh') refresh?: string) {
    return this.media.listMyAvatars(this.viewer(ctx), q, refresh === 'true');
  }

  /**
   * Avatar come personaggi, con stato di creazione e consenso: comprende anche quelli ancora in
   * addestramento o in attesa del consenso, che l'elenco sopra non mostra.
   */
  @Get('groups')
  groups(@CurrentContext() ctx: AuthContext, @Query('refresh') refresh?: string) {
    return this.media.listAvatarGroups(this.viewer(ctx), refresh === 'true');
  }

  /**
   * Avvia (o rinnova) la raccolta del consenso di un digital twin. Ritorna il link, valido 24 ore,
   * da far aprire alla persona ritratta. Lo stato si legge poi da `groups`.
   */
  @Post(':groupId/consent')
  requestConsent(@CurrentContext() ctx: AuthContext, @Param('groupId') groupId: string) {
    return this.media.requestAvatarConsent(this.viewer(ctx), groupId);
  }

  /** Aziende e utenti a cui si può assegnare un avatar (admin). */
  @Get('access/targets')
  @Roles('ADMIN')
  targets(@CurrentContext() ctx: AuthContext) {
    return this.access.targets(this.viewer(ctx));
  }

  /** Cambia a chi appartiene un avatar: azienda (solo la piattaforma) e utenti ammessi (vuoto = tutti). */
  @Put(':groupId/access')
  @Roles('ADMIN')
  assign(@CurrentContext() ctx: AuthContext, @Param('groupId') groupId: string, @Body() dto: AssignAvatarDto) {
    return this.access.assign(this.viewer(ctx), groupId, { tenantId: dto.tenantId, userIds: dto.userIds });
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
    @Body('consentConfirmed') consent: string | undefined,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (!file) throw new BadRequestException('Nessuna immagine ricevuta (campo "file")');
    if (!name?.trim()) throw new BadRequestException('Nome avatar mancante (campo "name")');
    return this.media.createAvatar(ctx.tenant.tenantId, {
      type: 'photo',
      name: name.trim(),
      image: { bytes: file.buffer, contentType: file.mimetype },
      consentConfirmed: consent === 'true',
      userId: ctx.userId,
    });
  }

  /**
   * Crea un DIGITAL TWIN da un video (multipart: "file" + "name" + "consentConfirmed"). Il video di
   * addestramento (circa 2 minuti, una persona che parla in primo piano) è caricato su HeyGen e
   * l'addestramento richiede qualche minuto. Prima di usarlo la persona deve dare il consenso
   * (vedi `:groupId/consent`). A pagamento una tantum.
   */
  @Post('twin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 150 * 1024 * 1024 } }))
  createTwin(
    @CurrentContext() ctx: AuthContext,
    @Body('name') name: string | undefined,
    @Body('consentConfirmed') consent: string | undefined,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
  ) {
    this.assertCanCreateTwin(ctx);
    if (!file) throw new BadRequestException('Nessun video ricevuto (campo "file")');
    if (!name?.trim()) throw new BadRequestException('Nome avatar mancante (campo "name")');
    return this.media.createAvatar(ctx.tenant.tenantId, {
      type: 'digital_twin',
      name: name.trim(),
      video: { bytes: file.buffer, contentType: file.mimetype },
      consentConfirmed: consent === 'true',
      userId: ctx.userId,
    });
  }

  /** Apre il caricamento a pezzi del video del twin (solo utenti Knowkube). */
  @Post('twin/uploads')
  startTwinUpload(@CurrentContext() ctx: AuthContext, @Body() body: { contentType?: string; sizeBytes?: number }) {
    this.assertCanCreateTwin(ctx);
    return this.media.startTwinUpload(ctx.tenant.tenantId, { contentType: String(body?.contentType ?? ''), sizeBytes: Number(body?.sizeBytes) });
  }

  /** Un pezzo del video (corpo binario, application/octet-stream). */
  @Put('twin/uploads/part')
  async uploadTwinPart(
    @CurrentContext() ctx: AuthContext,
    @Query('key') key: string,
    @Query('uploadId') uploadId: string,
    @Query('partNumber') partNumber: string,
    @Req() req: NodeJS.ReadableStream,
  ) {
    this.assertCanCreateTwin(ctx);
    const limit = MediaService.TWIN_PART_BYTES;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req as AsyncIterable<Buffer>) {
      size += c.length;
      if (size > limit) throw new BadRequestException('Pezzo troppo grande');
      chunks.push(c);
    }
    return this.media.uploadTwinPart(ctx.tenant.tenantId, {
      key: String(key ?? ''),
      uploadId: String(uploadId ?? ''),
      partNumber: Number(partNumber),
      body: Buffer.concat(chunks),
    });
  }

  /** Annulla un caricamento a pezzi lasciato a metà. */
  @Post('twin/uploads/abort')
  async abortTwinUpload(@CurrentContext() ctx: AuthContext, @Body() body: { key?: string; uploadId?: string }) {
    await this.media.abortTwinUpload(ctx.tenant.tenantId, { key: String(body?.key ?? ''), uploadId: String(body?.uploadId ?? '') });
    return { aborted: true };
  }

  /** Chiude il caricamento a pezzi e crea il digital twin. */
  @Post('twin/uploads/complete')
  completeTwinUpload(
    @CurrentContext() ctx: AuthContext,
    @Body() body: { key?: string; uploadId?: string; parts?: Array<{ partNumber: number; etag: string }>; name?: string; consentConfirmed?: boolean },
  ) {
    this.assertCanCreateTwin(ctx);
    const parts = Array.isArray(body?.parts)
      ? body.parts.map((p) => ({ partNumber: Number(p?.partNumber), etag: String(p?.etag ?? '') })).filter((p) => Number.isInteger(p.partNumber) && p.etag)
      : [];
    return this.media.createTwinFromUpload(ctx.tenant.tenantId, {
      key: String(body?.key ?? ''),
      uploadId: String(body?.uploadId ?? ''),
      parts,
      name: String(body?.name ?? ''),
      consentConfirmed: body?.consentConfirmed === true,
      userId: ctx.userId,
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
    return this.media.deleteAvatar(this.viewer(ctx), groupId);
  }
}
