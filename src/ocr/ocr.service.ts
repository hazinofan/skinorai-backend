import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExtractIngredientsResponseDto } from './dto/extract-ingredients-response.dto';

type GoogleVisionResponse = {
  responses?: Array<{
    fullTextAnnotation?: {
      text?: string;
    };
    textAnnotations?: Array<{
      description?: string;
    }>;
    error?: {
      message?: string;
    };
  }>;
};

type IngredientExtraction = {
  ingredientsText: string;
  ingredients: string[];
  warnings: string[];
};

const INGREDIENT_KEYWORDS = [
  'ingredients',
  'ingrédients',
  'inci',
  'composition',
  'ingredientes',
];

const STOP_KEYWORDS = [
  'directions',
  'usage',
  'warnings',
  'caution',
  'made in',
  'distributed by',
  'barcode',
  'www.',
  'customer service',
];

const METADATA_TOKEN_PATTERN =
  /^\s*(?:\(?(?:inci|ingredients|ingr[ée]dients|ingrÃ©dients)\)?|:)\s*$/i;

const METADATA_PREFIX_PATTERN =
  /^\s*(?:\(?(?:inci|ingredients|ingr[ée]dients|ingrÃ©dients)\)?\s*[:.-]?\s*)+/i;

const OCR_CORRECTIONS: Array<[RegExp, string]> = [
  [/\bAloe\s+Barbadens\s+Leaf\s+Juice\b/gi, 'Aloe Barbadensis Leaf Juice'],
  [/\bAloe\s+Barbadens\b/gi, 'Aloe Barbadensis'],
];

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(private readonly configService: ConfigService) {}

  async extractIngredientsFromImage(
    file: Express.Multer.File,
  ): Promise<ExtractIngredientsResponseDto> {
    const rawText = await this.detectText(file.buffer);
    const extraction = this.extractIngredients(rawText);
    const result = {
      rawText,
      ingredientsText: extraction.ingredientsText,
      ingredients: extraction.ingredients,
      warnings: extraction.warnings,
    };

    this.logger.log(`OCR extraction result: ${JSON.stringify(result)}`);

    return result;
  }

  private async detectText(imageBuffer: Buffer): Promise<string> {
    const apiKey = this.configService.get<string>('GOOGLE_VISION_API_KEY');

    if (!apiKey) {
      throw new InternalServerErrorException(
        'Google Vision API key is not configured.',
      );
    }

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              image: {
                content: imageBuffer.toString('base64'),
              },
              features: [
                {
                  type: 'DOCUMENT_TEXT_DETECTION',
                },
              ],
            },
          ],
        }),
      },
    ).catch(() => {
      throw new InternalServerErrorException(
        'Google Vision OCR request failed.',
      );
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        'Google Vision OCR request failed.',
      );
    }

    const data = (await response.json()) as GoogleVisionResponse;
    const firstResponse = data.responses?.[0];

    if (firstResponse?.error) {
      throw new InternalServerErrorException(
        'Google Vision OCR request failed.',
      );
    }

    const rawText =
      firstResponse?.fullTextAnnotation?.text ??
      firstResponse?.textAnnotations?.[0]?.description ??
      '';

    if (!rawText.trim()) {
      throw new UnprocessableEntityException('No text detected in image.');
    }

    return rawText;
  }

  private extractIngredients(rawText: string): IngredientExtraction {
    const warnings: string[] = [];
    const keywordMatch = this.findIngredientKeyword(rawText);
    let ingredientsText = rawText;

    if (keywordMatch) {
      ingredientsText = rawText.slice(keywordMatch.endIndex);
    } else {
      warnings.push(
        'Ingredient keyword not found. Please review the extracted text manually.',
      );
    }

    ingredientsText = this.stopAtUnrelatedSection(ingredientsText).trim();
    ingredientsText = this.cleanIngredientsText(ingredientsText);

    return {
      ingredientsText,
      ingredients: this.splitIngredients(ingredientsText),
      warnings,
    };
  }

  private findIngredientKeyword(rawText: string): { endIndex: number } | null {
    const normalizedText = rawText.toLowerCase();
    const matches = INGREDIENT_KEYWORDS.map((keyword) => {
      const index = normalizedText.indexOf(keyword);
      return index === -1 ? null : { index, endIndex: index + keyword.length };
    }).filter(Boolean) as Array<{ index: number; endIndex: number }>;

    if (!matches.length) {
      return null;
    }

    const firstMatch = matches.sort((a, b) => a.index - b.index)[0];
    const separatorMatch = rawText
      .slice(firstMatch.endIndex, firstMatch.endIndex + 4)
      .match(/^\s*[:.-]\s*/);

    return {
      endIndex: firstMatch.endIndex + (separatorMatch?.[0].length ?? 0),
    };
  }

  private stopAtUnrelatedSection(value: string): string {
    const normalizedValue = value.toLowerCase();
    const stopIndexes = STOP_KEYWORDS.map((keyword) =>
      normalizedValue.indexOf(keyword),
    ).filter((index) => index >= 0);

    if (!stopIndexes.length) {
      return value;
    }

    return value.slice(0, Math.min(...stopIndexes));
  }

  private cleanIngredientsText(value: string): string {
    const withoutMetadata = value
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !METADATA_TOKEN_PATTERN.test(line))
      .join('\n')
      .replace(METADATA_PREFIX_PATTERN, '')
      .replace(/^[\s:;,.•·-]+/, '')
      .trim();

    return this.applyOcrCorrections(
      this.normalizeIngredientLineBreaks(withoutMetadata),
    );
  }

  private normalizeIngredientLineBreaks(value: string): string {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((normalizedText, line) => {
        if (!normalizedText) {
          return line;
        }

        return `${normalizedText} ${line}`;
      }, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private applyOcrCorrections(value: string): string {
    return OCR_CORRECTIONS.reduce(
      (correctedValue, [pattern, replacement]) =>
        correctedValue.replace(pattern, replacement),
      value,
    );
  }

  private splitIngredients(ingredientsText: string): string[] {
    const seen = new Set<string>();

    return ingredientsText
      .split(/[,;•·]+/)
      .map((ingredient) =>
        this.applyOcrCorrections(
          ingredient
            .replace(METADATA_PREFIX_PATTERN, '')
            .replace(/^[\s:;,.•·-]+/, '')
            .replace(/[\s:;,.•·-]+$/, '')
            .replace(/\s+/g, ' ')
            .trim(),
        ),
      )
      .filter(Boolean)
      .filter((ingredient) => {
        const normalized = ingredient.toLowerCase();

        if (seen.has(normalized)) {
          return false;
        }

        seen.add(normalized);
        return true;
      });
  }
}
