export type AuthProvider = 'email' | 'google';
export type PlanStatus = 'free' | 'pro';

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  provider: AuthProvider;
  planStatus: PlanStatus;
  freeScansUsed: number;
  freeScanLimit: number;
  preferredSkinGoal?: string | null;
};

export type StoredUser = PublicUser & {
  passwordHash?: string;
  googleId?: string;
};

export type AuthResponse = {
  token: string;
  user: PublicUser;
};

export type JwtUser = {
  sub: string;
  email: string;
};

export type GoogleProfile = {
  googleId: string;
  email: string;
  name: string;
};
