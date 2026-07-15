import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AuthProvider, PlanStatus } from '../auth.types';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: ['email', 'google'], default: 'email' })
  provider: AuthProvider;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  passwordHash?: string;

  @Column({ name: 'google_id', type: 'varchar', length: 255, nullable: true })
  googleId?: string;

  @Column({ name: 'plan_status', type: 'varchar', length: 20, default: 'free' })
  planStatus: PlanStatus;

  @Column({ name: 'free_scans_used', type: 'int', default: 0 })
  freeScansUsed: number;

  @Column({
    name: 'preferred_skin_goal',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  preferredSkinGoal?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
