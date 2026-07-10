import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ProductType =
  | 'cleanser'
  | 'serum'
  | 'moisturizer'
  | 'spf'
  | 'exfoliant'
  | 'treatment';

export type SkinType =
  | 'dry'
  | 'oily'
  | 'combination'
  | 'sensitive'
  | 'normal';

export type SkinGoal =
  | 'hydration'
  | 'acne'
  | 'barrier'
  | 'redness'
  | 'glow'
  | 'anti_age'
  | 'oil_control';

@Entity({ name: 'products' })
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  slug: string;

  @Column()
  name: string;

  @Column()
  brand: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'image_path' })
  imagePath: string;

  @Column({ name: 'product_type', type: 'varchar', length: 40 })
  productType: ProductType;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price?: string | null;

  @Column({ type: 'varchar', length: 10, default: 'MAD' })
  currency: string;

  @Column({ name: 'skin_types', type: 'simple-json' })
  skinTypes: SkinType[];

  @Column({ type: 'simple-json' })
  goals: SkinGoal[];

  @Column({ name: 'key_ingredients', type: 'simple-json' })
  keyIngredients: string[];

  @Column({ name: 'watchout_ingredients', type: 'simple-json' })
  watchoutIngredients: string[];

  @Column({ name: 'avoid_for', type: 'simple-json' })
  avoidFor: string[];

  @Column({ type: 'simple-json' })
  tags: string[];

  @Column({ type: 'simple-json' })
  badges: string[];

  @Column({ type: 'simple-json' })
  benefits: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
