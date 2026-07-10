export class RegisterDto {
  name?: string;
  email: string;
  password: string;
}

export class LoginDto {
  email: string;
  password: string;
}

export class UpdateProfileDto {
  name?: string;
  preferredSkinGoal?: string;
  skinGoal?: string;
}

export class UpdatePasswordDto {
  currentPassword?: string;
  oldPassword?: string;
  newPassword?: string;
  password?: string;
}
