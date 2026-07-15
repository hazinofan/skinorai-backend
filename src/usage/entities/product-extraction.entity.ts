import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';

@Entity({ name: 'product_extractions' })
export class ProductExtractionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'simple-json' })
  extraction: unknown;

  @Column({ name: 'mime_type', length: 40 })
  mimeType: string;

  @Column({ name: 'image_bytes', type: 'int' })
  imageBytes: number;

  @Column({ name: 'provider', length: 30 })
  provider: string;

  @Column({ name: 'model', length: 120 })
  model: string;

  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens: number;

  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens: number;

  @Column({ name: 'latency_ms', type: 'int', default: 0 })
  latencyMs: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
