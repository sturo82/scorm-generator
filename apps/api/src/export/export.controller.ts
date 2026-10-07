import { Body, Controller, Param, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ExportService } from './export.service.js';

class ExportDto {
  /** Opzionale: se assente si usa il brand primario del corso. */
  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsIn(['SCORM_2004_4TH', 'SCORM_12'])
  profile?: 'SCORM_2004_4TH' | 'SCORM_12';

  @IsOptional()
  @IsBoolean()
  allowUnapproved?: boolean;

  /** Attiva la ricerca semantica (TF-IDF cosine) nel widget "Chiedi al corso". */
  @IsOptional()
  @IsBoolean()
  includeSemanticSearch?: boolean;
}

/**
 * API di export SCORM (Requisito 9.3). Richiede ruolo EDITOR. Restituisce un
 * URL firmato per scaricare il pacchetto generato.
 */
@Controller('courses/:courseId/export')
@Roles('EDITOR')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post()
  export(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Body() dto: ExportDto,
  ) {
    return this.exportService.exportCourse({
      tenantId: ctx.tenant.tenantId,
      courseId,
      brandId: dto.brandId,
      profile: dto.profile ?? 'SCORM_2004_4TH',
      allowUnapproved: dto.allowUnapproved,
      includeSemanticSearch: dto.includeSemanticSearch,
      authContext: ctx,
    });
  }
}
