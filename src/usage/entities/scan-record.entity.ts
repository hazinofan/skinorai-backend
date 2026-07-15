import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';

@Entity({ name: 'scan_records' })
export class ScanRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'product_name', default: 'Produit analysé' })
  productName: string;

  @Column({ name: 'skin_goal', type: 'varchar', length: 80, nullable: true })
  skinGoal?: string;

  @Column({ type: 'simple-json', nullable: true })
  ingredients?: string[];

  @Column({
    name: 'extracted_product_data',
    type: 'simple-json',
    nullable: true,
  })
  extractedProductData?: unknown;

  @Column({ name: 'trusted_product_data', type: 'simple-json', nullable: true })
  trustedProductData?: unknown;

  @Column({
    name: 'full_ingredient_list_visible',
    type: 'boolean',
    default: false,
  })
  fullIngredientListVisible: boolean;

  @Column({ name: 'analysis_result', type: 'simple-json' })
  analysisResult: unknown;

  @Column({ name: 'conversation', type: 'simple-json', nullable: true })
  conversation?: unknown[];

  @Column({ name: 'conversation_summary', type: 'text', nullable: true })
  conversationSummary?: string | null;

  @Column({ name: 'prompt_count', type: 'int', default: 0 })
  promptCount: number;

  @Column({ name: 'analysis_provider', type: 'varchar', length: 30, nullable: true })
  analysisProvider?: string | null;

  @Column({ name: 'analysis_model', type: 'varchar', length: 120, nullable: true })
  analysisModel?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
