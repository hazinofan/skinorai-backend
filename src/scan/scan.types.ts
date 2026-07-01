export type IngredientStatus = 'OK' | 'A surveiller';

export type IngredientItem = {
  name: string;
  status: IngredientStatus;
};

export type ResultDetail = {
  name: string;
  note: string;
};

export type AnalysisResult = {
  score: number;
  verdict: string;
  summary: string;
  positives: ResultDetail[];
  watchouts: ResultDetail[];
  tips: string[];
  questions: string[];
  nextStep: string;
};

export type ScanAnalysisResponse = {
  productName: string;
  ingredientItems: IngredientItem[];
  analysisResult: AnalysisResult;
};

export type ScanChatResponse = {
  answer: string;
  suggestions: string[];
  quota?: {
    planStatus: 'free' | 'pro';
    freeScanLimit: number;
    freeScansUsed: number;
    freeScansRemaining: number;
    freePromptLimit: number;
    promptCount: number;
    promptsRemaining: number;
  };
};
