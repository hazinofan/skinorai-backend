import { Injectable } from '@nestjs/common';
import { AnalyzeScanDto } from './dto/analyze-scan.dto';
import { ChatScanDto } from './dto/chat-scan.dto';
import {
  AnalysisResult,
  IngredientItem,
  IngredientStatus,
  ScanAnalysisResponse,
  ScanChatResponse,
} from './scan.types';

type SkinGoal = {
  id: string;
  label: string;
  accentLabel: string;
  positiveMatches: string[];
  tips: string[];
  questions: string[];
  nextStep: string;
};

const goals: SkinGoal[] = [
  {
    id: 'hydration',
    label: 'Hydratation',
    accentLabel: 'hydrater et repulper',
    positiveMatches: [
      'glycerin',
      'hyaluron',
      'panthenol',
      'betaine',
      'urea',
      'aloe',
    ],
    tips: [
      'Appliquez sur peau legerement humide.',
      'Scellez ensuite avec une creme hydratante.',
      'Utilisez un SPF le matin.',
    ],
    questions: [
      'Puis-je utiliser ce produit avec du retinol ?',
      'Est-ce un bon choix pour une peau deshydratee ?',
    ],
    nextStep:
      'Utilisez 2 a 3 fois par semaine au debut, puis augmentez si votre peau reste confortable.',
  },
  {
    id: 'acne',
    label: 'Acne & imperfections',
    accentLabel: 'cibler les imperfections',
    positiveMatches: [
      'salicy',
      'niacinamide',
      'zinc',
      'sulfur',
      'tea tree',
      'azela',
    ],
    tips: [
      'Introduisez le produit progressivement.',
      'Evitez de le superposer avec trop d actifs irritants.',
      'Hydratez bien la peau pour proteger la barriere.',
    ],
    questions: [
      'Ce produit aide-t-il pour les boutons inflammatoires ?',
      'Puis-je l utiliser le meme jour qu un exfoliant ?',
    ],
    nextStep:
      'Commencez doucement et observez si la formule aide sans augmenter la sensibilite.',
  },
  {
    id: 'barrier',
    label: 'Reparation de la barriere',
    accentLabel: 'renforcer la barriere cutanee',
    positiveMatches: [
      'ceramide',
      'panthenol',
      'squalane',
      'cholesterol',
      'centella',
      'oat',
    ],
    tips: [
      'Favorisez une routine simple pendant quelques jours.',
      'Evitez les exfoliants forts si la peau est reactive.',
      'Appliquez sur peau propre avec des gestes doux.',
    ],
    questions: [
      'Est-ce adapte apres une irritation ?',
      'Ce produit soutient-il une barriere abimee ?',
    ],
    nextStep:
      'Associez-le a des formules simples et evitez les actifs trop puissants le meme jour.',
  },
  {
    id: 'redness',
    label: 'Rougeurs',
    accentLabel: 'apaiser les rougeurs',
    positiveMatches: [
      'allantoin',
      'centella',
      'panthenol',
      'bisabolol',
      'aloe',
      'oat',
    ],
    tips: [
      'Testez d abord sur une petite zone.',
      'Evitez l eau trop chaude apres application.',
      'Associez-le a une routine tres douce.',
    ],
    questions: [
      'Ce produit convient-il a une peau sensible ?',
      'Y a-t-il des ingredients qui peuvent aggraver les rougeurs ?',
    ],
    nextStep:
      'Si votre peau reagit facilement, utilisez-le seul pendant quelques jours pour evaluer la tolerance.',
  },
  {
    id: 'oily',
    label: 'Peau grasse',
    accentLabel: 'equilibrer l exces de sebum',
    positiveMatches: [
      'niacinamide',
      'zinc',
      'salicy',
      'green tea',
      'clay',
      'tea tree',
    ],
    tips: [
      'Appliquez en fine couche pour eviter l effet lourd.',
      'Ne sautez pas l hydratation meme si la peau est grasse.',
      'Surveillez si le produit laisse un fini confortable.',
    ],
    questions: [
      'Ce produit risque-t-il de boucher les pores ?',
      'Est-ce une bonne option pour limiter la brillance ?',
    ],
    nextStep:
      'Observez le fini sur la zone T et combinez-le avec une routine legere et non comedogene.',
  },
  {
    id: 'morning',
    label: 'Routine du matin',
    accentLabel: 'optimiser la routine du matin',
    positiveMatches: [
      'vitamin c',
      'niacinamide',
      'caffeine',
      'green tea',
      'hyaluron',
      'glycerin',
    ],
    tips: [
      'Superposez du plus leger au plus riche.',
      'Terminez toujours par un SPF.',
      'Gardez la routine simple pour gagner du temps le matin.',
    ],
    questions: [
      'Ce produit se combine-t-il bien avec la vitamine C ?',
      'Est-ce une bonne etape avant la creme solaire ?',
    ],
    nextStep:
      'Utilisez-le dans une routine courte et verifiez qu il se superpose bien sous la protection solaire.',
  },
];

const defaultIngredients: IngredientItem[] = [
  { name: 'Aqua (Water)', status: 'OK' },
  { name: 'Glycerin', status: 'OK' },
  { name: 'Niacinamide', status: 'OK' },
  { name: 'Propanediol', status: 'OK' },
  { name: 'Sodium Hyaluronate', status: 'OK' },
  { name: 'Panthenol', status: 'OK' },
  { name: 'Allantoin', status: 'OK' },
  { name: 'Parfum (Fragrance)', status: 'A surveiller' },
  { name: 'Alcohol Denat.', status: 'A surveiller' },
  { name: 'Citric Acid', status: 'OK' },
];

const watchTerms = [
  'parfum',
  'fragrance',
  'alcohol',
  'denat',
  'essential oil',
  'citric acid',
];

@Injectable()
export class ScanService {
  analyzeScan(dto: AnalyzeScanDto): ScanAnalysisResponse {
    const goal = this.resolveGoal(dto.goalId, dto.goalLabel);
    const ingredientItems = this.resolveIngredients(dto.ingredients);

    return {
      productName:
        dto.productName?.trim() || dto.imageNames?.[0] || 'Produit analyse',
      ingredientItems,
      analysisResult: this.buildAnalysisResult(goal, ingredientItems),
    };
  }

  answerQuestion(dto: ChatScanDto): ScanChatResponse {
    const question =
      dto.question?.trim() || 'Que dois-je savoir sur ce produit ?';
    const loweredQuestion = question.toLowerCase();
    const watchouts = dto.analysisResult?.watchouts ?? [];
    const positives = dto.analysisResult?.positives ?? [];
    const goalLabel = dto.goalLabel || 'votre objectif peau';
    const productName = dto.productName || 'ce produit';

    let answer = `${productName} semble coherent avec ${goalLabel}, surtout si vous l introduisez progressivement et que vous observez la tolerance de votre peau.`;

    if (
      loweredQuestion.includes('retinol') ||
      loweredQuestion.includes('exfoliant') ||
      loweredQuestion.includes('acide')
    ) {
      answer = `Oui, mais evitez de superposer ${productName} avec trop d actifs puissants le meme soir. Alternez avec le retinol ou les exfoliants, puis gardez une creme reparatrice si votre peau tire.`;
    } else if (
      loweredQuestion.includes('sensible') ||
      loweredQuestion.includes('irrit')
    ) {
      answer = watchouts.length
        ? `Pour une peau sensible, avancez doucement: ${watchouts.map((item) => item.name).join(', ')} meritent un test localise avant usage regulier.`
        : `La formule ne montre pas de gros signal irritant dans cette analyse, mais faites quand meme un test localise pendant 24 h si votre peau reagit vite.`;
    } else if (
      loweredQuestion.includes('matin') ||
      loweredQuestion.includes('spf') ||
      loweredQuestion.includes('soleil')
    ) {
      answer = `Le matin, appliquez ${productName} avant la protection solaire si la texture se superpose bien. Le SPF reste la derniere etape indispensable.`;
    } else if (
      loweredQuestion.includes('score') ||
      loweredQuestion.includes('bon')
    ) {
      answer = `Le score vient des ingredients utiles pour ${goalLabel}, des points a surveiller et de l adequation globale. Les points forts principaux sont: ${positives.map((item) => item.name).join(', ') || 'la base de la formule'}.`;
    }

    return {
      answer,
      suggestions: [
        'Comment l integrer dans ma routine ?',
        'Quels ingredients dois-je surveiller ?',
        'Puis-je l utiliser matin et soir ?',
      ],
    };
  }

  private resolveGoal(goalId?: string, goalLabel?: string): SkinGoal {
    return (
      goals.find((goal) => goal.id === goalId) ??
      goals.find(
        (goal) => goal.label.toLowerCase() === goalLabel?.toLowerCase(),
      ) ??
      goals[0]
    );
  }

  private resolveIngredients(
    ingredients?: string[] | string,
  ): IngredientItem[] {
    const parsedIngredients = Array.isArray(ingredients)
      ? ingredients
      : typeof ingredients === 'string'
        ? this.parseIngredientText(ingredients)
        : [];

    if (!parsedIngredients.length) {
      return defaultIngredients;
    }

    return parsedIngredients.map((name) => {
      const normalized = name.toLowerCase();
      const shouldWatch = watchTerms.some((term) => normalized.includes(term));

      return {
        name,
        status: shouldWatch ? 'A surveiller' : 'OK',
      };
    });
  }

  private parseIngredientText(value: string): string[] {
    return value
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private buildAnalysisResult(
    goal: SkinGoal,
    ingredientItems: IngredientItem[],
  ): AnalysisResult {
    const positivesBase = ingredientItems.filter(
      (item) => item.status === 'OK',
    );
    const watchoutsBase = ingredientItems.filter(
      (item) => item.status === 'A surveiller',
    );
    const matchedPositives = positivesBase.filter((item) =>
      goal.positiveMatches.some((keyword) =>
        item.name.toLowerCase().includes(keyword),
      ),
    );

    const positives = (
      matchedPositives.length > 0 ? matchedPositives : positivesBase
    )
      .slice(0, 3)
      .map((item) => ({
        name: this.toTitleCase(item.name),
        note: this.buildIngredientNote(item.name, goal.id, item.status),
      }));

    const watchouts = watchoutsBase.slice(0, 3).map((item) => ({
      name: this.toTitleCase(item.name),
      note: this.buildIngredientNote(item.name, goal.id, item.status),
    }));

    const rawScore = 6.2 + positives.length * 0.9 - watchouts.length * 0.55;
    const score = Number(Math.min(9.6, Math.max(4.2, rawScore)).toFixed(1));

    return {
      score,
      verdict:
        score >= 8.5
          ? 'Excellent Match'
          : score < 6.5
            ? 'Mixed Match'
            : 'Good Choice',
      summary:
        positives.length > 0
          ? `Ce produit semble globalement adapte pour ${goal.accentLabel}. Il presente ${positives.length} point${positives.length > 1 ? 's' : ''} positif${positives.length > 1 ? 's' : ''}${watchouts.length > 0 ? ` avec ${watchouts.length} element${watchouts.length > 1 ? 's' : ''} a surveiller` : ''}.`
          : `L analyse montre quelques points utiles pour ${goal.accentLabel}, mais la formule reste a verifier selon votre tolerance.`,
      positives,
      watchouts,
      tips: goal.tips,
      questions: goal.questions,
      nextStep: goal.nextStep,
    };
  }

  private buildIngredientNote(
    name: string,
    goalId: string,
    status: IngredientStatus,
  ): string {
    const normalized = name.toLowerCase();

    if (status === 'A surveiller') {
      if (normalized.includes('fragrance') || normalized.includes('parfum')) {
        return 'Peut etre irritant sur les peaux sensibles.';
      }

      if (normalized.includes('alcohol') || normalized.includes('denat')) {
        return 'Peut etre dessechant selon la sensibilite de votre peau.';
      }

      if (normalized.includes('essential oil')) {
        return 'A surveiller si votre peau reagit facilement.';
      }

      return 'Ingredient a surveiller selon votre tolerance.';
    }

    const goalSpecificNotes: Record<string, string> = {
      hydration: 'Aide a soutenir l hydratation cutanee.',
      acne: 'Peut aider a garder une routine plus ciblee sur les imperfections.',
      barrier: 'Soutient une routine orientee confort et barriere.',
      redness: 'Interesse pour une routine plus apaisante.',
      oily: 'Peut convenir a une routine pour peau grasse.',
      morning: 'S integre bien dans une routine du matin simple.',
    };

    return goalSpecificNotes[goalId] ?? 'Point positif pour cet objectif peau.';
  }

  private toTitleCase(value: string): string {
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
  }
}
