import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApplicationError, type ProviderCredentialInput } from "@canalis/application";
import type { ProviderSecretEnvelope } from "@canalis/persistence";

const ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  const raw = process.env.CANALIS_PROVIDER_SECRET_KEY?.trim();
  if (!raw) {
    throw new ApplicationError(
      "PROVIDER_SECRET_KEY_NOT_CONFIGURED",
      "Provider credentials require CANALIS_PROVIDER_SECRET_KEY. Configure a base64-encoded 32-byte key before saving credentials.",
      503,
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new ApplicationError(
      "PROVIDER_SECRET_KEY_INVALID",
      "CANALIS_PROVIDER_SECRET_KEY must be a base64-encoded 32-byte key.",
      503,
    );
  }
  if (key.length !== 32) {
    throw new ApplicationError(
      "PROVIDER_SECRET_KEY_INVALID",
      "CANALIS_PROVIDER_SECRET_KEY must decode to exactly 32 bytes.",
      503,
    );
  }
  return key;
}

export function sealProviderCredential(input: ProviderCredentialInput): ProviderSecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(input.secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function openProviderCredential(envelope: ProviderSecretEnvelope): string {
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== ALGORITHM ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new ApplicationError(
      "PROVIDER_CREDENTIAL_INVALID",
      "Stored provider credential is not a supported encrypted envelope.",
      500,
    );
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      "PROVIDER_CREDENTIAL_DECRYPT_FAILED",
      "Stored provider credential could not be decrypted with the configured key.",
      500,
    );
  }
}
