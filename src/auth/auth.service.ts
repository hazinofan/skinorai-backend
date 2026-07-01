import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { AuthResponse, GoogleProfile, JwtUser, PublicUser } from './auth.types';
import { UsersService } from './users.service';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const email = this.validateEmail(registerDto.email);
    const password = this.validatePassword(registerDto.password);
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.usersService.createEmailUser({
      email,
      name: registerDto.name?.trim() || '',
      passwordHash,
    });

    return this.buildAuthResponse(this.usersService.toPublicUser(user));
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const email = this.validateEmail(loginDto.email);
    const password = this.validatePassword(loginDto.password);
    const user = await this.usersService.findByEmail(email);

    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.buildAuthResponse(this.usersService.toPublicUser(user));
  }

  async loginWithGoogle(profile: GoogleProfile): Promise<AuthResponse> {
    const user = await this.usersService.upsertGoogleUser(profile);
    return this.buildAuthResponse(this.usersService.toPublicUser(user));
  }

  async getCurrentUser(jwtUser: JwtUser): Promise<PublicUser> {
    const user = await this.usersService.findById(jwtUser.sub);

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    return this.usersService.toPublicUser(user);
  }

  private buildAuthResponse(user: PublicUser): AuthResponse {
    return {
      token: this.jwtService.sign({
        sub: user.id,
        email: user.email,
      }),
      user,
    };
  }

  private validateEmail(value?: string): string {
    const email = value?.trim().toLowerCase();

    if (!email || !EMAIL_PATTERN.test(email)) {
      throw new BadRequestException('A valid email is required.');
    }

    return email;
  }

  private validatePassword(value?: string): string {
    if (!value || value.length < 8) {
      throw new BadRequestException(
        'Password must contain at least 8 characters.',
      );
    }

    return value;
  }
}
