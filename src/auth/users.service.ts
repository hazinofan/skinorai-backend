import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublicUser } from './auth.types';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  async createEmailUser({
    email,
    name,
    passwordHash,
  }: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<UserEntity> {
    const normalizedEmail = this.normalizeEmail(email);
    const existingUser = await this.usersRepository.findOneBy({
      email: normalizedEmail,
    });

    if (existingUser) {
      throw new ConflictException('An account already exists for this email.');
    }

    const user = this.usersRepository.create({
      email: normalizedEmail,
      name: name || normalizedEmail.split('@')[0],
      provider: 'email',
      passwordHash,
    });

    return this.usersRepository.save(user);
  }

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.usersRepository.findOneBy({
      email: this.normalizeEmail(email),
    });
  }

  findById(userId: string): Promise<UserEntity | null> {
    return this.usersRepository.findOneBy({ id: userId });
  }

  save(user: UserEntity): Promise<UserEntity> {
    return this.usersRepository.save(user);
  }

  async upsertGoogleUser({
    googleId,
    email,
    name,
  }: {
    googleId: string;
    email: string;
    name: string;
  }): Promise<UserEntity> {
    const normalizedEmail = this.normalizeEmail(email);
    const existingUser = await this.usersRepository.findOneBy({
      email: normalizedEmail,
    });

    if (existingUser) {
      existingUser.googleId = googleId;
      existingUser.provider = 'google';
      existingUser.name =
        existingUser.name || name || normalizedEmail.split('@')[0];
      return this.usersRepository.save(existingUser);
    }

    const user = this.usersRepository.create({
      email: normalizedEmail,
      name: name || normalizedEmail.split('@')[0],
      provider: 'google',
      googleId,
    });

    return this.usersRepository.save(user);
  }

  toPublicUser(user: UserEntity): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      provider: user.provider,
      planStatus: user.planStatus ?? 'free',
      freeScansUsed: user.freeScansUsed ?? 0,
      freeScanLimit: 3,
      preferredSkinGoal: user.preferredSkinGoal ?? null,
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
