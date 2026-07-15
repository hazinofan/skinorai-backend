import { z } from 'zod';

export const faceObservationSchema = z.object({
  usable: z.boolean(),
  imageType: z.enum(['face', 'unrelated', 'unclear']),
  quality: z.object({
    lighting: z.enum(['good', 'acceptable', 'poor']),
    focus: z.enum(['good', 'acceptable', 'poor']),
    faceCoverage: z.enum(['complete', 'partial', 'insufficient']),
    filterOrHeavyMakeupSuspected: z.boolean(),
  }),
  observations: z
    .array(
      z.object({
        area: z.enum([
          'forehead',
          'nose',
          'cheeks',
          'chin',
          'under_eyes',
          'general',
        ]),
        concern: z.enum([
          'visible_shine',
          'apparent_dryness',
          'visible_flaking',
          'visible_redness',
          'visible_blemishes',
          'uneven_looking_texture',
          'visible_pores',
          'dark_looking_spots',
          'under_eye_darkness',
        ]),
        description: z.string().min(1).max(300),
        confidence: z.enum(['low', 'medium', 'high']),
      }),
    )
    .max(30),
  limitations: z.array(z.string()).max(20),
  retakeInstructions: z.array(z.string()).max(10),
  professionalReviewSuggested: z.boolean(),
});

export const faceObservationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'usable',
    'imageType',
    'quality',
    'observations',
    'limitations',
    'retakeInstructions',
    'professionalReviewSuggested',
  ],
  properties: {
    usable: { type: 'boolean' },
    imageType: { type: 'string', enum: ['face', 'unrelated', 'unclear'] },
    quality: {
      type: 'object',
      additionalProperties: false,
      required: [
        'lighting',
        'focus',
        'faceCoverage',
        'filterOrHeavyMakeupSuspected',
      ],
      properties: {
        lighting: { type: 'string', enum: ['good', 'acceptable', 'poor'] },
        focus: { type: 'string', enum: ['good', 'acceptable', 'poor'] },
        faceCoverage: {
          type: 'string',
          enum: ['complete', 'partial', 'insufficient'],
        },
        filterOrHeavyMakeupSuspected: { type: 'boolean' },
      },
    },
    observations: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'concern', 'description', 'confidence'],
        properties: {
          area: {
            type: 'string',
            enum: [
              'forehead',
              'nose',
              'cheeks',
              'chin',
              'under_eyes',
              'general',
            ],
          },
          concern: {
            type: 'string',
            enum: [
              'visible_shine',
              'apparent_dryness',
              'visible_flaking',
              'visible_redness',
              'visible_blemishes',
              'uneven_looking_texture',
              'visible_pores',
              'dark_looking_spots',
              'under_eye_darkness',
            ],
          },
          description: { type: 'string' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    },
    limitations: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    retakeInstructions: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10,
    },
    professionalReviewSuggested: { type: 'boolean' },
  },
} as const;
