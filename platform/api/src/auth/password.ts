import { hash, verify } from "@node-rs/argon2";

/** argon2id with the library's OWASP-aligned defaults (19 MiB, 2 passes). */
export const hashPassword = (password: string): Promise<string> => hash(password);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** A real hash of a random string, so a login for an unknown email takes as long as one for a known email. */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> => (dummy ??= hash(`dummy-${Math.random()}-${Date.now()}`));

const COMMON = new Set([
  "password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop", "iloveyou12", "letmein1234",
  "welcome1234", "admin12345", "changeme123", "0123456789",
]);

export interface PasswordCheck {
  ok: boolean;
  problems: string[];
}

/** Length first (NIST 800-63B): at least 10 characters, at most 128, not a well-known password, not the email. */
export function checkPasswordPolicy(password: string, email?: string): PasswordCheck {
  const problems: string[] = [];
  if (password.length < 10) problems.push("must be at least 10 characters");
  if (password.length > 128) problems.push("must be at most 128 characters");
  if (/^(.)\1+$/.test(password)) problems.push("must not be one repeated character");
  if (COMMON.has(password.toLowerCase())) problems.push("is a commonly used password");
  if (email && password.toLowerCase() === email.toLowerCase()) problems.push("must not equal the email address");
  return { ok: problems.length === 0, problems };
}
