import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type {
  AuthResponse,
  GoogleProfile,
  JwtUser,
  PublicUser,
} from './auth.types';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

type AuthenticatedRequest = Request & {
  user: JwtUser;
};

type GoogleRequest = Request & {
  user: GoogleProfile;
};

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  register(@Body() registerDto: RegisterDto): Promise<AuthResponse> {
    return this.authService.register(registerDto);
  }

  @Post('login')
  login(@Body() loginDto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(loginDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest): Promise<PublicUser> {
    return this.authService.getCurrentUser(request.user);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  google() {
    return;
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @Req() request: GoogleRequest,
    @Res() response: Response,
  ) {
    const authResponse = await this.authService.loginWithGoogle(request.user);
    const frontendOrigin =
      this.configService.get<string>('FRONTEND_ORIGIN') ||
      'http://localhost:3000';
    const callbackUrl = new URL('/auth/callback', frontendOrigin);
    callbackUrl.searchParams.set('token', authResponse.token);
    callbackUrl.searchParams.set('name', authResponse.user.name);
    callbackUrl.searchParams.set('email', authResponse.user.email);
    response.redirect(callbackUrl.toString());
  }
}
