export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  permissions: string[];
}

export function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.isAdmin || user.permissions.includes(key);
}
