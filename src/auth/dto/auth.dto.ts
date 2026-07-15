import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  preferredSkinGoal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  skinGoal?: string;
}

export class UpdatePasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  oldPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password?: string;
}
