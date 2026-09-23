import { Algorithm, hashSync, verifySync } from "@node-rs/argon2";

export function hashPassword(password: string): string {
  return hashSync(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  try {
    return verifySync(passwordHash, password);
  } catch {
    return false;
  }
}
