import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'ai_usage_events' })
@Index(['userId', 'createdAt'])
export class AiUsageEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'scan_id', type: 'varchar', length: 36, nullable: true })
  scanId?: string | null;

  @Column({ name: 'face_scan_id', type: 'varchar', length: 36, nullable: true })
  faceScanId?: string | null;

  @Column({ length: 30 })
  provider: string;

  @Column({ length: 120 })
  model: string;

  @Column({ name: 'request_type', length: 50 })
  requestType: string;

  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens: number;

  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens: number;

  @Column({
    name: 'estimated_cost_usd',
    type: 'decimal',
    precision: 12,
    scale: 8,
    default: 0,
  })
  estimatedCostUsd: string;

  @Column({ name: 'latency_ms', type: 'int', default: 0 })
  latencyMs: number;

  @Column({ type: 'boolean', default: true })
  success: boolean;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
