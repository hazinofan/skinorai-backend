export type AiProviderName = 'gemini' | 'deepseek' | 'local-fallback';

export type AiRequestType =
  | 'product_extraction'
  | 'product_analysis'
  | 'text_chat'
  | 'product_image_chat'
  | 'face_scan'
  | 'face_chat'
  | 'summary';

export type AiUsageMetadata = {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type ProviderResult<T> = {
  data: T;
  provider: AiProviderName;
  model: string;
  usage: AiUsageMetadata;
};

export type ConversationAttachment = {
  type: 'image';
  mimeType: string;
  url?: string;
};

export type LibrarySuggestion = {
  products: Array<{
    id: string;
    slug: string;
    name: string;
    brand: string;
    imagePath: string;
    productType: string;
    matchScore: number;
    reason: string;
  }>;
  ingredients: Array<{
    id: string;
    name: string;
    category: string;
    reason: string;
  }>;
};

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  provider: AiProviderName;
  model: string;
  requestType: AiRequestType;
  attachment?: ConversationAttachment;
  visualContext?: Record<string, unknown>;
  librarySuggestions?: LibrarySuggestion;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type ProductExtraction = {
  usable: boolean;
  imageType:
    | 'product_front'
    | 'product_label'
    | 'product_multiple'
    | 'unrelated'
    | 'unclear';
  brand: string | null;
  productName: string | null;
  productCategory: string | null;
  visibleText: string;
  visibleClaims: string[];
  ingredients: string[];
  fullIngredientListVisible: boolean;
  uncertainText: string[];
  confidence: 'low' | 'medium' | 'high';
  warnings: string[];
  retakeInstructions: string[];
};

export type FaceObservation = {
  usable: boolean;
  imageType: 'face' | 'unrelated' | 'unclear';
  quality: {
    lighting: 'good' | 'acceptable' | 'poor';
    focus: 'good' | 'acceptable' | 'poor';
    faceCoverage: 'complete' | 'partial' | 'insufficient';
    filterOrHeavyMakeupSuspected: boolean;
  };
  observations: Array<{
    area: 'forehead' | 'nose' | 'cheeks' | 'chin' | 'under_eyes' | 'general';
    concern:
      | 'visible_shine'
      | 'apparent_dryness'
      | 'visible_flaking'
      | 'visible_redness'
      | 'visible_blemishes'
      | 'uneven_looking_texture'
      | 'visible_pores'
      | 'dark_looking_spots'
      | 'under_eye_darkness';
    description: string;
    confidence: 'low' | 'medium' | 'high';
  }>;
  limitations: string[];
  retakeInstructions: string[];
  professionalReviewSuggested: boolean;
};

export type ProductImageChatContext = {
  imageType:
    | 'product_front'
    | 'product_label'
    | 'face'
    | 'unrelated'
    | 'unclear';
  visibleText: string;
  observations: string[];
  confidence: 'low' | 'medium' | 'high';
  warnings: string[];
};
