import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, isNull } from "drizzle-orm";

import { tx, type Db } from "./client";
import { apiKeys } from "./schema";

export const SCOPES = ["dashboard:read", "dashboard:write"] as const;
export type Scope = (typeof SCOPES)[number];

const TOKEN = /^sk_dash_([a-z2-7]{10})_([A-Za-z0-9_-]{43})$/;
const MAX_KEYS = 50;
const LAST_USED_RESOLUTION_SECONDS = 60;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export interface PublicKey {
  id: string;
  name: string;
  masked: string;
  scopes: string[];
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface AuthenticatedKey {
  id: string;
  name: string;
  scopes: Set<string>;
}

export class TooManyKeysError extends Error {}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + BASE32[(value << (5 - bits)) & 31] : out;
}

function toPublic(row: typeof apiKeys.$inferSelect): PublicKey {
  return {
    id: row.id,
    name: row.name,
    masked: `sk_dash_${row.prefix.slice(0, 4)}…`,
    scopes: row.scopes.split(" "),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

/** Bearer keys `sk_dash_<prefix>_<secret>`. Only an HMAC digest (keyed by the pepper) is stored. */
export class ApiKeys {
  constructor(
    private readonly db: Db,
    private readonly pepper: string,
  ) {}

  private digest(token: string): string {
    return createHmac("sha256", this.pepper).update(token).digest("hex");
  }

  create(name: string, scopes: Scope[], expiresAt: number | null): { key: PublicKey; token: string } {
    const prefix = base32(randomBytes(10)).slice(0, 10);
    const token = `sk_dash_${prefix}_${randomBytes(32).toString("base64url")}`;
    const row = {
      id: `key_${randomBytes(8).toString("hex")}`,
      name,
      prefix,
      digest: this.digest(token),
      scopes: [...new Set(scopes)].sort().join(" "),
      createdAt: nowSeconds(),
      expiresAt,
    };
    tx(this.db, (db) => {
      const [{ active }] = db.select({ active: count() }).from(apiKeys).where(isNull(apiKeys.revokedAt)).all() as [{ active: number }];
      if (active >= MAX_KEYS) throw new TooManyKeysError("too_many_keys");
      db.insert(apiKeys).values(row).run();
    });
    return { key: toPublic({ ...row, lastUsedAt: null, revokedAt: null }), token };
  }

  list(): PublicKey[] {
    return this.db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)).all().map(toPublic);
  }

  revoke(id: string): PublicKey | null {
    return tx(this.db, (db) => {
      db.update(apiKeys)
        .set({ revokedAt: nowSeconds() })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .run();
      const row = db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
      return row ? toPublic(row) : null;
    });
  }

  /** Constant-time check. Unknown, revoked and expired keys all return null. */
  authenticate(token: string): AuthenticatedKey | null {
    const match = TOKEN.exec(token);
    // One digest is always computed, so timing does not reveal whether the format or the prefix matched.
    const digest = Buffer.from(this.digest(token));
    const row = match ? this.db.select().from(apiKeys).where(eq(apiKeys.prefix, match[1]!)).get() : undefined;
    const stored = Buffer.from(row?.digest ?? "0".repeat(64));
    const now = nowSeconds();
    if (!timingSafeEqual(stored, digest) || !row || row.revokedAt !== null || (row.expiresAt && row.expiresAt <= now)) return null;
    if (!row.lastUsedAt || now - row.lastUsedAt >= LAST_USED_RESOLUTION_SECONDS) {
      this.db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id)).run();
    }
    return { id: row.id, name: row.name, scopes: new Set(row.scopes.split(" ")) };
  }
}
