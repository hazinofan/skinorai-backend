import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AnalyzeFaceScanDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  consentAccepted: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  skinGoal?: string;
}

export class FaceMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}

export class RenameFaceConversationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;
}
