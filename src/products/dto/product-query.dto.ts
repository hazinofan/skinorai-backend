import type { ProductType, SkinGoal, SkinType } from '../entities/product.entity';

export type SensitivityLevel = 'low' | 'medium' | 'high';
export type ProductSort = 'recommended' | 'score' | 'newest' | 'name';

export class ProductQueryDto {
  page?: string;
  limit?: string;
  skinType?: SkinType | 'all';
  goal?: SkinGoal | 'all';
  sensitivity?: SensitivityLevel | 'all';
  productType?: ProductType | 'all';
  avoidIngredients?: string;
  search?: string;
  sort?: ProductSort;
}
