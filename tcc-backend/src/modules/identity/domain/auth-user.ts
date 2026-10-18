export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  permissions: string[];
}
