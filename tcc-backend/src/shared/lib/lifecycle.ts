export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** Throws the error built by `makeError` when the item has expired. */
export function assertLive(expiresAt: Date, now: Date, makeError: () => Error): void {
  if (isExpired(expiresAt, now)) throw makeError();
}

/** If expired, runs `onExpire` (e.g. persist the status) and returns true. */
export async function expireIfStale(expiresAt: Date, now: Date, onExpire: () => Promise<void>): Promise<boolean> {
  if (!isExpired(expiresAt, now)) return false;
  await onExpire();
  return true;
}
