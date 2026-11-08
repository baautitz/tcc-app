/** Identificador opaco do participante (P01...). Rejeita qualquer coisa que pareça nome ou e-mail. */
const PARTICIPANT_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

export const PARTICIPANT_HEADER = "x-participant-id";

export function resolveParticipant(
  header: string | null | undefined,
  fallback: string | undefined,
): string | undefined {
  for (const candidate of [header?.trim(), fallback?.trim()])
    if (candidate && PARTICIPANT_PATTERN.test(candidate)) return candidate;
  return undefined;
}
