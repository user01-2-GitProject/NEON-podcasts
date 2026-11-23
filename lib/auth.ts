import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function roleForEmail(email: string): "owner" | "member" {
  const owners = (process.env.OWNER_EMAILS || "").split(",").map((value) => value.trim().toLowerCase());
  return owners.includes(email.trim().toLowerCase()) ? "owner" : "member";
}

export function validOwnerSecret(input: string): boolean {
  const expected = process.env.OWNER_SIGNUP_SECRET;
  if (!expected || !input || input.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(input), Buffer.from(expected));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  if (!/^[0-9a-f]{32}$/.test(salt || "") || !/^[0-9a-f]{128}$/.test(hex || "")) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hex, "hex"));
}
