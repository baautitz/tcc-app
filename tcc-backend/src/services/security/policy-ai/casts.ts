import { QueryInputValidationError, type Token } from "../sql-lexer.js";
import { SAFE_TYPE_MODIFIER_NAMES, SAFE_TYPE_NAMES, TYPE_LITERAL_BOUNDARY_WORDS } from "./safe-lists.js";

function normalizeTypeToken(token: Token | undefined): string | undefined {
  if (!token || (token.kind !== "word" && token.kind !== "quoted_identifier"))
    return undefined;
  return token.kind === "word"
    ? token.value.toLocaleLowerCase("en-US")
    : token.value;
}

/** Parses one approved built-in type prefix and returns the token after its array suffixes. */
function parseSafeTypePrefix(
  tokens: Token[],
  start: number,
): number | undefined {
  let cursor = start;
  const first = normalizeTypeToken(tokens[cursor]);
  if (!first) return undefined;

  if (tokens[cursor + 1]?.value === ".") {
    if (first !== "pg_catalog") return undefined;
    cursor += 2;
  }

  const typeWords: string[] = [];
  const maxWords = Math.max(
    ...SAFE_TYPE_NAMES.map((name) => name.split(" ").length),
  );
  while (typeWords.length < maxWords) {
    const value = normalizeTypeToken(tokens[cursor + typeWords.length]);
    if (!value) break;
    typeWords.push(value);
  }

  let typeName: string | undefined;
  let typeNameLength = 0;
  for (const candidate of SAFE_TYPE_NAMES) {
    const parts = candidate.split(" ");
    if (
      parts.length <= typeWords.length &&
      parts.every((part, index) => part === typeWords[index])
    ) {
      typeName = candidate;
      typeNameLength = parts.length;
      break;
    }
  }
  if (!typeName) return undefined;
  cursor += typeNameLength;

  if (tokens[cursor]?.value === "(" && SAFE_TYPE_MODIFIER_NAMES.has(typeName)) {
    cursor += 1;
    let modifierCount = 0;
    while (true) {
      const number = tokens[cursor];
      if (number?.kind !== "number" || number.value.length > 4)
        return undefined;
      modifierCount += 1;
      cursor += 1;
      if (tokens[cursor]?.value !== ",") break;
      if (modifierCount >= 2) return undefined;
      cursor += 1;
    }
    if (tokens[cursor]?.value !== ")") return undefined;
    cursor += 1;
  }

  if (typeName === "time" || typeName === "timestamp") {
    if (
      tokens[cursor]?.value === "with" &&
      tokens[cursor + 1]?.value === "time" &&
      tokens[cursor + 2]?.value === "zone"
    ) {
      cursor += 3;
    } else if (
      tokens[cursor]?.value === "without" &&
      tokens[cursor + 1]?.value === "time" &&
      tokens[cursor + 2]?.value === "zone"
    ) {
      cursor += 3;
    }
  }

  if (typeName === "interval") {
    if (tokens[cursor]?.value === "(") {
      cursor += 1;
      const precision = tokens[cursor];
      if (precision?.kind !== "number" || precision.value.length > 4)
        return undefined;
      cursor += 1;
      if (tokens[cursor]?.value !== ")") return undefined;
      cursor += 1;
    }
    const startField = tokens[cursor]?.value;
    if (
      ["year", "month", "day", "hour", "minute", "second"].includes(
        startField ?? "",
      )
    ) {
      cursor += 1;
      if (startField === "second" && tokens[cursor]?.value === "(") {
        cursor += 1;
        const precision = tokens[cursor];
        if (precision?.kind !== "number" || precision.value.length > 4)
          return undefined;
        cursor += 1;
        if (tokens[cursor]?.value !== ")") return undefined;
        cursor += 1;
      }
      if (tokens[cursor]?.value === "to") {
        cursor += 1;
        const endField = tokens[cursor]?.value;
        if (
          !["month", "day", "hour", "minute", "second"].includes(endField ?? "")
        )
          return undefined;
        cursor += 1;
        if (endField === "second" && tokens[cursor]?.value === "(") {
          cursor += 1;
          const precision = tokens[cursor];
          if (precision?.kind !== "number" || precision.value.length > 4)
            return undefined;
          cursor += 1;
          if (tokens[cursor]?.value !== ")") return undefined;
          cursor += 1;
        }
      }
    }
  }

  while (true) {
    if (tokens[cursor]?.value === "array") cursor += 1;
    if (tokens[cursor]?.value !== "[") break;
    cursor += 1;
    if (tokens[cursor]?.kind === "number") cursor += 1;
    if (tokens[cursor]?.value !== "]") return undefined;
    cursor += 1;
  }
  return cursor;
}

function isTypeLiteralBoundary(token: Token | undefined): boolean {
  if (!token) return true;
  if (token.kind === "operator" || token.kind === "parameter") return true;
  if (token.kind === "punctuation")
    return ["(", ",", "["].includes(token.value);
  return token.kind === "word" && TYPE_LITERAL_BOUNDARY_WORDS.has(token.value);
}

function isTypeLikeSequence(
  tokens: Token[],
  start: number,
  end: number,
): boolean {
  if (start >= end) return false;
  for (const token of tokens.slice(start, end)) {
    if (
      token.kind === "word" ||
      token.kind === "quoted_identifier" ||
      token.kind === "number"
    )
      continue;
    if (
      token.kind === "punctuation" &&
      [".", "(", ")", ",", "[", "]"].includes(token.value)
    )
      continue;
    return false;
  }
  return true;
}

export function assertAiCastTypes(tokens: Token[]): void {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (
      token.kind === "word" &&
      token.value === "cast" &&
      tokens[index + 1]?.value === "("
    ) {
      const castOpen = index + 1;
      let depth = 1;
      let castClose = castOpen + 1;
      while (castClose < tokens.length && depth > 0) {
        if (tokens[castClose]?.value === "(") depth += 1;
        else if (tokens[castClose]?.value === ")") depth -= 1;
        if (depth > 0) castClose += 1;
      }
      if (depth !== 0)
        throw new QueryInputValidationError("INVALID_SQL", "CAST incompleto.");
      let nestedDepth = 0;
      let asIndex = -1;
      for (let cursor = castOpen + 1; cursor < castClose; cursor += 1) {
        if (tokens[cursor]?.value === "(") nestedDepth += 1;
        else if (tokens[cursor]?.value === ")") nestedDepth -= 1;
        else if (
          nestedDepth === 0 &&
          tokens[cursor]?.kind === "word" &&
          tokens[cursor]?.value === "as"
        ) {
          asIndex = cursor;
          break;
        }
      }
      if (asIndex < 0 || parseSafeTypePrefix(tokens, asIndex + 1) !== castClose)
        throw new QueryInputValidationError(
          "INVALID_SQL",
          "CAST só pode converter para tipos PostgreSQL built-in aprovados.",
        );
    }

    if (token.kind === "operator" && token.value === "::") {
      if (!parseSafeTypePrefix(tokens, index + 1))
        throw new QueryInputValidationError(
          "INVALID_SQL",
          "Casts PostgreSQL só podem usar tipos built-in aprovados.",
        );
    }

    if (token.kind !== "string") continue;
    if (
      tokens[index - 1]?.value === "zone" &&
      tokens[index - 2]?.value === "time" &&
      tokens[index - 3]?.value === "at"
    )
      continue;
    if (
      tokens[index - 1]?.kind === "word" &&
      TYPE_LITERAL_BOUNDARY_WORDS.has(tokens[index - 1]!.value)
    )
      continue;
    if (
      tokens[index - 1]?.kind !== "word" &&
      tokens[index - 1]?.kind !== "quoted_identifier" &&
      ![")", "]"].includes(tokens[index - 1]?.value ?? "")
    )
      continue;
    const minimumStart = Math.max(0, index - 12);
    let candidateStart = index - 1;
    while (
      candidateStart >= minimumStart &&
      isTypeLikeSequence(tokens, candidateStart, index) &&
      !(
        tokens[candidateStart]?.kind === "word" &&
        TYPE_LITERAL_BOUNDARY_WORDS.has(tokens[candidateStart]!.value)
      ) &&
      !isTypeLiteralBoundary(tokens[candidateStart - 1])
    ) {
      candidateStart -= 1;
    }
    if (
      candidateStart < index &&
      isTypeLikeSequence(tokens, candidateStart, index) &&
      isTypeLiteralBoundary(tokens[candidateStart - 1])
    ) {
      const safeTypeEnd = parseSafeTypePrefix(tokens, candidateStart);
      if (safeTypeEnd !== index)
        throw new QueryInputValidationError(
          "INVALID_SQL",
          "Literais tipados só podem usar tipos PostgreSQL built-in aprovados.",
        );
    }
  }
}

