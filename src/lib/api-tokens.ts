import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiToken, user } from "@/db/schema";

// Personal API tokens: `rb_` + 32 random bytes. They carry enough entropy that a plain SHA-256 is the
// right storage (no salt/slow hash needed), and lookups are by hash so there's no string comparison to time.

const PREFIX = "rb_";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createApiToken(userId: string, name: string) {
  const token = PREFIX + randomBytes(32).toString("base64url");
  const [row] = await db
    .insert(apiToken)
    .values({ id: crypto.randomUUID(), userId, name, tokenHash: hash(token), hint: token.slice(-4) })
    .returning({
      id: apiToken.id,
      name: apiToken.name,
      hint: apiToken.hint,
      lastUsedAt: apiToken.lastUsedAt,
      createdAt: apiToken.createdAt,
    });
  return { ...row, token };
}

export async function listApiTokens(userId: string) {
  return db
    .select({
      id: apiToken.id,
      name: apiToken.name,
      hint: apiToken.hint,
      lastUsedAt: apiToken.lastUsedAt,
      createdAt: apiToken.createdAt,
    })
    .from(apiToken)
    .where(eq(apiToken.userId, userId))
    .orderBy(desc(apiToken.createdAt));
}

export type ApiTokenSummary = Awaited<ReturnType<typeof listApiTokens>>[number];

export async function revokeApiToken(userId: string, id: string) {
  const rows = await db
    .delete(apiToken)
    .where(and(eq(apiToken.id, id), eq(apiToken.userId, userId)))
    .returning({ id: apiToken.id });
  return rows.length > 0;
}

// The user behind `Authorization: Bearer rb_…`, or null. Only the API routes that opt in call this, so
// a token can submit jobs and read their status but can't do anything else a session can.
export async function userFromToken(request: Request) {
  const m = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  if (!m || !m[1].startsWith(PREFIX)) return null;
  const [row] = await db
    .select({ tokenId: apiToken.id, id: user.id, email: user.email, lastUsedAt: apiToken.lastUsedAt })
    .from(apiToken)
    .innerJoin(user, eq(user.id, apiToken.userId))
    .where(eq(apiToken.tokenHash, hash(m[1])));
  if (!row) return null;
  // Coarse "last used" (at most once a minute) so polling doesn't write on every request.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiToken).set({ lastUsedAt: new Date() }).where(eq(apiToken.id, row.tokenId));
  }
  return { id: row.id, email: row.email };
}
