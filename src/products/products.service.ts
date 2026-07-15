import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductEntity } from './entities/product.entity';
import { PRODUCT_SEEDS } from './products.seed';

type ScoredProduct = ProductEntity & {
  matchScore: number;
  matchReasons: string[];
  warnings: string[];
};

const DEFAULT_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 24;

@Injectable()
export class ProductsService implements OnModuleInit {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productsRepository: Repository<ProductEntity>,
  ) {}

  async onModuleInit() {
    const count = await this.productsRepository.count();
    if (count > 0) return;

    await this.productsRepository.save(
      PRODUCT_SEEDS.map((product) => this.productsRepository.create(product)),
    );
  }

  async listProducts(query: ProductQueryDto) {
    const page = this.parsePositiveNumber(query.page, 1);
    const limit = Math.min(
      this.parsePositiveNumber(query.limit, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );

    const searchTerm = query.search?.trim();
    let products = await this.productsRepository.find({
      where: searchTerm
        ? [
            { name: Like(`%${searchTerm}%`), isActive: true },
            { brand: Like(`%${searchTerm}%`), isActive: true },
          ]
        : { isActive: true },
      order: { createdAt: 'DESC' },
    });

    if (query.productType && query.productType !== 'all') {
      products = products.filter(
        (product) => product.productType === query.productType,
      );
    }

    const scored = products
      .map((product) => this.scoreProduct(product, query))
      .filter((product) => this.matchesHardFilters(product, query));

    const hasRecommendationInput = this.hasRecommendationInput(query);
    const sorted = scored.sort((left, right) => {
      if (query.sort === 'name') return left.name.localeCompare(right.name);
      if (query.sort === 'newest')
        return right.createdAt.getTime() - left.createdAt.getTime();
      if (
        hasRecommendationInput ||
        query.sort === 'recommended' ||
        query.sort === 'score'
      ) {
        return (
          right.matchScore - left.matchScore ||
          left.name.localeCompare(right.name)
        );
      }
      return right.createdAt.getTime() - left.createdAt.getTime();
    });

    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    const items = sorted
      .slice(start, start + limit)
      .map((product) => this.toResponse(product));

    return {
      items,
      meta: {
        page: safePage,
        limit,
        total,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1,
        isPersonalized: hasRecommendationInput,
      },
    };
  }

  async getProduct(slug: string) {
    const product = await this.productsRepository.findOneBy({
      slug,
      isActive: true,
    });
    if (!product) throw new NotFoundException('Product not found.');
    return this.toResponse(this.scoreProduct(product, {}));
  }

  async suggestProducts(query: ProductQueryDto, limit = 3) {
    const products = await this.productsRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });
    return products
      .map((product) => this.scoreProduct(product, query))
      .filter((product) => this.matchesHardFilters(product, query))
      .sort(
        (left, right) =>
          right.matchScore - left.matchScore ||
          left.name.localeCompare(right.name),
      )
      .slice(0, Math.max(1, Math.min(limit, 6)))
      .map((product) => this.toResponse(product));
  }

  async findReliableMatch(brand?: string | null, productName?: string | null) {
    const normalizedBrand = this.normalizeProductIdentity(brand);
    const normalizedName = this.normalizeProductIdentity(productName);
    if (!normalizedName) return null;

    const products = await this.productsRepository.find({
      where: { isActive: true },
    });
    const exact = products.find((product) => {
      const nameMatches =
        this.normalizeProductIdentity(product.name) === normalizedName;
      const brandMatches =
        !normalizedBrand ||
        this.normalizeProductIdentity(product.brand) === normalizedBrand;
      return nameMatches && brandMatches;
    });

    if (!exact) return null;
    return {
      id: exact.id,
      name: exact.name,
      brand: exact.brand,
      description: exact.description,
      productType: exact.productType,
      keyIngredients: exact.keyIngredients,
      watchoutIngredients: exact.watchoutIngredients,
      benefits: exact.benefits,
      tags: exact.tags,
      verifiedFromDatabase: true,
    };
  }

  private hasRecommendationInput(query: ProductQueryDto) {
    return Boolean(
      (query.skinType && query.skinType !== 'all') ||
      (query.goal && query.goal !== 'all') ||
      (query.sensitivity && query.sensitivity !== 'all') ||
      query.avoidIngredients?.trim(),
    );
  }

  private matchesHardFilters(product: ScoredProduct, query: ProductQueryDto) {
    if (
      query.skinType &&
      query.skinType !== 'all' &&
      !product.skinTypes.includes(query.skinType)
    ) {
      return false;
    }

    if (
      query.goal &&
      query.goal !== 'all' &&
      !product.goals.includes(query.goal)
    ) {
      return false;
    }

    return true;
  }

  private scoreProduct(
    product: ProductEntity,
    query: ProductQueryDto,
  ): ScoredProduct {
    let score = 55;
    const reasons: string[] = [];
    const warnings: string[] = [];
    const avoidIngredients = this.parseList(query.avoidIngredients).map(
      (item) => item.toLowerCase(),
    );

    if (query.skinType && query.skinType !== 'all') {
      if (product.skinTypes.includes(query.skinType)) {
        score += 20;
        reasons.push(`Adapté à ${this.labelSkinType(query.skinType)}`);
      } else {
        score -= 15;
      }
    }

    if (query.goal && query.goal !== 'all') {
      if (product.goals.includes(query.goal)) {
        score += 22;
        reasons.push(`Cible ${this.labelGoal(query.goal)}`);
      } else {
        score -= 12;
      }
    }

    if (query.sensitivity && query.sensitivity !== 'all') {
      const level = query.sensitivity;
      const isSensitiveProduct =
        product.skinTypes.includes('sensitive') ||
        product.tags.includes('sans parfum');
      if (level === 'high' && isSensitiveProduct) {
        score += 12;
        reasons.push('Option douce pour peau réactive');
      }
      if (level === 'high' && product.avoidFor.includes('very-sensitive')) {
        score -= 25;
        warnings.push('À introduire doucement si votre peau réagit vite');
      }
    }

    if (avoidIngredients.length > 0) {
      const productWatchouts = product.watchoutIngredients.map((item) =>
        item.toLowerCase(),
      );
      const productKeys = product.keyIngredients.map((item) =>
        item.toLowerCase(),
      );
      const matchedAvoid = avoidIngredients.filter((avoid) =>
        [...productWatchouts, ...productKeys].some((ingredient) =>
          ingredient.includes(avoid),
        ),
      );
      if (matchedAvoid.length > 0) {
        score -= 30;
        warnings.push(
          `Contient un élément à éviter: ${matchedAvoid.join(', ')}`,
        );
      } else {
        score += 8;
        reasons.push('Ne contient pas vos ingrédients à éviter');
      }
    }

    if (product.tags.includes('sans parfum')) {
      score += 5;
    }
    if (product.watchoutIngredients.length === 0) {
      score += 5;
    }

    if (reasons.length === 0) {
      reasons.push('Produit classé selon ses ingrédients et son type de peau');
    }

    return {
      ...product,
      matchScore: Math.max(0, Math.min(98, Math.round(score))),
      matchReasons: reasons.slice(0, 3),
      warnings: warnings.slice(0, 2),
    };
  }

  private normalizeProductIdentity(value?: string | null) {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private parsePositiveNumber(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : fallback;
  }

  private parseList(value?: string) {
    return (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private labelSkinType(value: string) {
    return (
      (
        {
          dry: 'la peau sèche',
          oily: 'la peau grasse',
          combination: 'la peau mixte',
          sensitive: 'la peau sensible',
          normal: 'la peau normale',
        } as Record<string, string>
      )[value] ?? value
    );
  }

  private labelGoal(value: string) {
    return (
      (
        {
          hydration: 'l’hydratation',
          acne: 'les imperfections',
          barrier: 'la barrière cutanée',
          redness: 'les rougeurs',
          glow: 'l’éclat et les taches',
          anti_age: 'l’anti-âge',
          oil_control: 'l’excès de sébum',
        } as Record<string, string>
      )[value] ?? value
    );
  }

  private toResponse(product: ScoredProduct) {
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      description: product.description,
      imagePath: product.imagePath,
      productType: product.productType,
      price: product.price ? Number(product.price) : null,
      currency: product.currency,
      skinTypes: product.skinTypes,
      goals: product.goals,
      keyIngredients: product.keyIngredients,
      watchoutIngredients: product.watchoutIngredients,
      avoidFor: product.avoidFor,
      tags: product.tags,
      badges: product.badges,
      benefits: product.benefits,
      matchScore: product.matchScore,
      matchReasons: product.matchReasons,
      warnings: product.warnings,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
