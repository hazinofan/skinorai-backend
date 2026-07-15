import { z } from 'zod';

export const analysisResponseSchema = z.object({
  score: z.number().min(0).max(10),
  verdict: z.enum([
    'excellent_match',
    'good_choice',
    'use_with_caution',
    'not_ideal',
  ]),
  verdictLabel: z.string().min(1).max(100),
  summary: z.string().min(1).max(600),
  positives: z
    .array(
      z.object({
        ingredient: z.string().min(1),
        reason: z.string().min(1).max(300),
        tag: z.string().min(1).max(80),
      }),
    )
    .max(6),
  watchouts: z
    .array(
      z.object({
        ingredient: z.string().min(1),
        reason: z.string().min(1).max(300),
        severity: z.enum(['low', 'medium', 'high']),
      }),
    )
    .max(6),
  recommendations: z.array(z.string().min(1).max(300)).max(6),
  nextStep: z.string().min(1).max(350),
  followUpQuestions: z.array(z.string().min(1).max(180)).max(5),
  disclaimer: z.string().min(1).max(400),
});

export const faceGuidanceSchema = z.object({
  explanation: z.string().min(1).max(700),
  priorities: z.array(z.string().min(1).max(250)).max(5),
  routineCategories: z
    .array(
      z.object({
        step: z.string().min(1).max(100),
        guidance: z.string().min(1).max(300),
      }),
    )
    .max(8),
  potentiallyUsefulIngredients: z.array(z.string().min(1).max(120)).max(10),
  introduceCautiously: z.array(z.string().min(1).max(180)).max(10),
  followUpQuestions: z.array(z.string().min(1).max(180)).max(5),
  disclaimer: z.string().min(1).max(400),
});

export const chatResponseSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const source = value as Record<string, unknown>;
  const answer =
    typeof source.answer === 'string'
      ? source.answer
      : typeof source.response === 'string'
        ? source.response
        : typeof source.message === 'string'
          ? source.message
          : '';
  const rawSuggestions = Array.isArray(source.suggestions)
    ? source.suggestions
    : Array.isArray(source.followUpQuestions)
      ? source.followUpQuestions
      : Array.isArray(source.questions)
        ? source.questions
        : [];

  return {
    answer: answer.trim().slice(0, 1800),
    suggestions: rawSuggestions
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 4)
      .map((item) => item.trim().slice(0, 180)),
  };
}, z.object({
  answer: z.string().min(1),
  suggestions: z.array(z.string()).default([]),
}));

export const summaryResponseSchema = z.object({
  summary: z.string().min(1).max(2500),
});

export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;
export type FaceGuidance = z.infer<typeof faceGuidanceSchema>;
export type ChatResponse = z.infer<typeof chatResponseSchema>;
