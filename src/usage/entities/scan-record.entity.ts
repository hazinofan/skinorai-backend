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

  @Column({ name: 'product_name', default: 'Produit analyse' })
  productName: string;

  @Column({ name: 'skin_goal', nullable: true })
  skinGoal?: string;

  @Column({ type: 'simple-json', nullable: true })
  ingredients?: string[];

  @Column({ name: 'analysis_result', type: 'simple-json' })
  analysisResult: unknown;

  @Column({ name: 'conversation', type: 'simple-json', nullable: true })
  conversation?: unknown[];

  @Column({ name: 'prompt_count', type: 'int', default: 0 })
  promptCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
