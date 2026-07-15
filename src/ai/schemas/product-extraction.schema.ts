import { z } from 'zod';

export const productExtractionSchema = z.object({
  usable: z.boolean(),
  imageType: z.enum([
    'product_front',
    'product_label',
    'product_multiple',
    'unrelated',
    'unclear',
  ]),
  brand: z.string().nullable(),
  productName: z.string().nullable(),
  productCategory: z.string().nullable(),
  visibleText: z.string(),
  visibleClaims: z.array(z.string()).max(20),
  ingredients: z.array(z.string()).max(250),
  fullIngredientListVisible: z.boolean(),
  uncertainText: z.array(z.string()).max(50),
  confidence: z.enum(['low', 'medium', 'high']),
  warnings: z.array(z.string()).max(20),
  retakeInstructions: z.array(z.string()).max(10),
});

export const productExtractionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'usable',
    'imageType',
    'brand',
    'productName',
    'productCategory',
    'visibleText',
    'visibleClaims',
    'ingredients',
    'fullIngredientListVisible',
    'uncertainText',
    'confidence',
    'warnings',
    'retakeInstructions',
  ],
  properties: {
    usable: { type: 'boolean' },
    imageType: {
      type: 'string',
      enum: [
        'product_front',
        'product_label',
        'product_multiple',
        'unrelated',
        'unclear',
      ],
    },
    brand: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    productName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    productCategory: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    visibleText: { type: 'string' },
    visibleClaims: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    ingredients: { type: 'array', items: { type: 'string' }, maxItems: 250 },
    fullIngredientListVisible: { type: 'boolean' },
    uncertainText: { type: 'array', items: { type: 'string' }, maxItems: 50 },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    warnings: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    retakeInstructions: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10,
    },
  },
} as const;

export const productImageChatContextSchema = z.object({
  imageType: z.enum([
    'product_front',
    'product_label',
    'face',
    'unrelated',
    'unclear',
  ]),
  visibleText: z.string().max(1200),
  observations: z.array(z.string().max(250)).max(12),
  confidence: z.enum(['low', 'medium', 'high']),
  warnings: z.array(z.string().max(250)).max(10),
});

export const productImageChatContextJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'imageType',
    'visibleText',
    'observations',
    'confidence',
    'warnings',
  ],
  properties: {
    imageType: {
      type: 'string',
      enum: ['product_front', 'product_label', 'face', 'unrelated', 'unclear'],
    },
    visibleText: { type: 'string' },
    observations: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    warnings: { type: 'array', items: { type: 'string' }, maxItems: 10 },
  },
} as const;
