export const validateDisplayName = (value: string): string | null => {
  const normalized = value.trim();
  if (!normalized) return 'Display name is required.';
  if (Array.from(normalized).length > 50) return 'Display name must be 50 characters or fewer.';
  return null;
};

export const passwordsMatch = (password: string, confirmPassword: string): boolean => password === confirmPassword;

export const createRegisterPayload = (displayName: string, email: string, password: string) => ({
  displayName: displayName.trim(),
  email: email.trim(),
  password
});

export interface ProfileIdentity {
  displayName?: string | null;
  name?: string | null;
  email: string;
}

export const getProfileDisplayName = ({ displayName, name, email }: ProfileIdentity): string =>
  displayName?.trim() || email.split('@', 1)[0]?.trim() || name?.trim() || email || 'User';

export const getProfileInitial = ({ displayName, email }: ProfileIdentity): string =>
  Array.from(displayName?.trim() || email.trim() || 'U')[0]?.toLocaleUpperCase() || 'U';
