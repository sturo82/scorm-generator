import { IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** DTO semplici validati dal ValidationPipe globale (class-validator). */

export class CreateCourseDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @MinLength(2)
  language!: string;
}

export class InstructorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  avatarKey?: string;
}

export class UpdateCourseSettingsDto {
  @IsOptional()
  @IsIn(['sober', 'lively'])
  interactionStyle?: 'sober' | 'lively';

  @IsOptional()
  @IsString()
  primaryBrandId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InstructorDto)
  instructor?: InstructorDto;
}

export class CreateModuleDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  summary?: string;
}

export class CreateLessonDto {
  @IsString()
  @MinLength(1)
  title!: string;
}

export class CreateAssessmentDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsIn(['INTERMEDIATE', 'FINAL'])
  scope!: 'INTERMEDIATE' | 'FINAL';

  @IsOptional()
  @IsString()
  moduleId?: string;
}
