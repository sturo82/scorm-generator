import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { StartAutopilot, type StartAutopilot as StartAutopilotType } from '@scorm/contracts';
import { CurrentContext, type AuthContext } from '../auth/auth-context.js';
import { Roles } from '../auth/roles.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AutopilotService } from './autopilot.service.js';
import { AvatarAccessService } from './avatar-access.service.js';

/** Generazione automatica del corso: avvio, stato, ripresa dopo la revisione, annullamento. */
@Controller('courses/:courseId/autopilot')
export class AutopilotController {
  constructor(
    private readonly autopilot: AutopilotService,
    private readonly avatarAccess: AvatarAccessService,
  ) {}

  @Get()
  status(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.autopilot.status(ctx.tenant.tenantId, courseId);
  }

  @Post()
  @Roles('EDITOR')
  async start(
    @CurrentContext() ctx: AuthContext,
    @Param('courseId') courseId: string,
    @Body(new ZodValidationPipe(StartAutopilot)) body: StartAutopilotType,
  ) {
    // Gli avatar dell'account sono solo di chi ne ha accesso; quelli del catalogo sono di tutti.
    if (body.slides) {
      await this.avatarAccess.assertAvatarUsable({ tenantId: ctx.tenant.tenantId, userId: ctx.userId, role: ctx.role }, body.slides.avatarId);
    }
    return this.autopilot.start(ctx, courseId, body);
  }

  @Post('resume')
  @Roles('EDITOR')
  resume(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.autopilot.resume(ctx.tenant.tenantId, courseId);
  }

  @Post('cancel')
  @Roles('EDITOR')
  cancel(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.autopilot.cancel(ctx.tenant.tenantId, courseId);
  }

  @Post('dismiss')
  dismiss(@CurrentContext() ctx: AuthContext, @Param('courseId') courseId: string) {
    return this.autopilot.dismiss(ctx.tenant.tenantId, courseId);
  }
}
