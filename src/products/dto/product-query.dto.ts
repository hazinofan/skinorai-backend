import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type {
  ProductType,
  SkinGoal,
  SkinType,
} from '../entities/product.entity';

export type SensitivityLevel = 'low' | 'medium' | 'high';
export type ProductSort = 'recommended' | 'score' | 'newest' | 'name';

export class ProductQueryDto {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
  @IsOptional()
  @IsIn(['dry', 'oily', 'combination', 'sensitive', 'normal', 'all'])
  skinType?: SkinType | 'all';
  @IsOptional()
  @IsIn([
    'hydration',
    'acne',
    'barrier',
    'redness',
    'glow',
    'anti_age',
    'oil_control',
    'all',
  ])
  goal?: SkinGoal | 'all';
  @IsOptional() @IsIn(['low', 'medium', 'high', 'all']) sensitivity?:
    | SensitivityLevel
    | 'all';
  @IsOptional()
  @IsIn([
    'cleanser',
    'serum',
    'moisturizer',
    'spf',
    'exfoliant',
    'treatment',
    'all',
  ])
  productType?: ProductType | 'all';
  @IsOptional() @IsString() @MaxLength(500) avoidIngredients?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional()
  @IsIn(['recommended', 'score', 'newest', 'name'])
  sort?: ProductSort;
}
