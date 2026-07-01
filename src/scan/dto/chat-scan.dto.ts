import type { AnalysisResult, IngredientItem } from '../scan.types';

export class ChatScanDto {
  scanId?: string;
  question?: string;
  productName?: string;
  goalLabel?: string;
  ingredients?: IngredientItem[];
  analysisResult?: AnalysisResult;
}
