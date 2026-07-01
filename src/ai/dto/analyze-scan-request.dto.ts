export type SkinGoal =
  | 'hydration'
  | 'acne'
  | 'barrier_repair'
  | 'redness'
  | 'oily_skin'
  | 'morning_routine'
  | 'sensitive_skin';

export class AnalyzeScanRequestDto {
  skinGoal: SkinGoal;
  productName?: string;
  productCategory?: string;
  ingredients: string[];
  ingredientsText?: string;
}
