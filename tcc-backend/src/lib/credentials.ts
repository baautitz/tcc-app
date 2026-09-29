import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function getKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY deve ser uma chave Base64 de exatamente 32 bytes.",
    );
  }
  return key;
}

export function encryptCredential(
  plaintext: string,
  encodedKey: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(encodedKey), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptCredential(payload: string, encodedKey: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] =
    payload.split(".");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("Credencial cifrada inválida.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(encodedKey),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
