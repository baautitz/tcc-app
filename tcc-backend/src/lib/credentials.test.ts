import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "./credentials.js";

const key = Buffer.alloc(32, 7).toString("base64");

describe("credential encryption", () => {
  it("cifra e decifra sem manter o texto original", () => {
    const plaintext = "senha-super-secreta";
    const encrypted = encryptCredential(plaintext, key);

    expect(encrypted).not.toContain(plaintext);
    expect(decryptCredential(encrypted, key)).toBe(plaintext);
  });

  it("rejeita chave com tamanho incorreto", () => {
    expect(() => encryptCredential("senha", Buffer.alloc(16).toString("base64"))).toThrow("32 bytes");
  });
});
