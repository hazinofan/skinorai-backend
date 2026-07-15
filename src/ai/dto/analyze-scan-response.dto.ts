export type ScanVerdict =
  | 'excellent_match'
  | 'good_choice'
  | 'use_with_caution'
  | 'not_ideal';
export type WatchoutSeverity = 'low' | 'medium' | 'high';

export class PositiveIngredientDto {
  ingredient: string;
  reason: string;
  tag: string;
}
export class WatchoutIngredientDto {
  ingredient: string;
  reason: string;
  severity: WatchoutSeverity;
}
export class QuotaStatusDto {
  planStatus: 'free' | 'pro';
  freeScanLimit: number;
  freeScansUsed: number;
  freeScansRemaining: number;
  freePromptLimit: number;
  promptCount: number;
  promptsRemaining: number;
}
export class AnalyzeScanResponseDto {
  scanId?: string;
  quota?: QuotaStatusDto;
  score: number;
  verdict: ScanVerdict;
  verdictLabel: string;
  summary: string;
  positives: PositiveIngredientDto[];
  watchouts: WatchoutIngredientDto[];
  recommendations: string[];
  nextStep: string;
  followUpQuestions: string[];
  disclaimer: string;
}
