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

@Entity({ name: 'face_scan_records' })
export class FaceScanRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'skin_goal', type: 'varchar', length: 80, nullable: true })
  skinGoal?: string | null;

  @Column({ name: 'custom_title', type: 'varchar', length: 160, nullable: true })
  customTitle?: string | null;

  @Column({ type: 'simple-json' })
  observations: unknown;

  @Column({ type: 'simple-json' })
  guidance: unknown;

  @Column({ type: 'simple-json', nullable: true })
  conversation?: unknown[];

  @Column({ name: 'conversation_summary', type: 'text', nullable: true })
  conversationSummary?: string | null;

  @Column({ name: 'prompt_count', type: 'int', default: 0 })
  promptCount: number;

  @Column({ name: 'consent_accepted', type: 'boolean', default: true })
  consentAccepted: boolean;

  @Column({ name: 'image_mime_types', type: 'simple-json', nullable: true })
  imageMimeTypes?: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
