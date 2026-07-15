import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const SKIN_GOALS = [
  'hydration',
  'acne',
  'barrier_repair',
  'redness',
  'oily_skin',
  'morning_routine',
  'sensitive_skin',
] as const;
export type SkinGoal = (typeof SKIN_GOALS)[number];

export class AnalyzeScanRequestDto {
  @IsIn(SKIN_GOALS)
  skinGoal: SkinGoal;

  @IsOptional()
  @IsUUID()
  extractionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  productCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  ingredientsText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(150)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  ingredients?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @IsString({ each: true })
  @MaxLength(240, { each: true })
  confirmedIngredients: string[];
}
