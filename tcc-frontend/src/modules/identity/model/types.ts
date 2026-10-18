export type Permission = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  system: boolean;
};

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  permissions: string[];
};

export type User = CurrentUser & { active: boolean; createdAt: string };
