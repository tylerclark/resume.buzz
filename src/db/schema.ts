import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { CoverStage, Fact, JobRequirement, JobStage, JobStatus, Resume, StoredTailored } from "@/lib/types";

// ---------- BetterAuth tables ----------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------- App tables ----------

export const baseResume = pgTable("base_resume", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Resume>().notNull(),
  facts: jsonb("facts").$type<Fact[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const job = pgTable(
  "job",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location").notNull().default(""),
    pay: text("pay").notNull().default(""),
    employmentType: text("employment_type").notNull().default(""),
    level: text("level").notNull().default(""),
    // Fit of the *base* resume (plus confirmed facts) to the posting: the "before" number. Never updated.
    score: integer("score").notNull().default(0),
    scoreNote: text("score_note").notNull().default(""),
    requirements: jsonb("requirements").$type<JobRequirement[]>().notNull().default([]),
    // Fit of the tailored resume: the "after" number, refreshed every time tailoring runs.
    tailoredScore: integer("tailored_score"),
    tailoredScoreNote: text("tailored_score_note"),
    tailoredRequirements: jsonb("tailored_requirements").$type<JobRequirement[]>(),
    keywordsHit: jsonb("keywords_hit").$type<string[]>().notNull().default([]),
    keywordsMissing: jsonb("keywords_missing").$type<string[]>().notNull().default([]),
    raw: text("raw").notNull(),
    prompt: text("prompt").notNull(),
    tailored: jsonb("tailored").$type<StoredTailored>(),
    // Hash of the base resume this was tailored from; differs from the current base when it's stale.
    baseHash: text("base_hash"),
    status: text("status").$type<JobStatus>().notNull().default("not_applied"),
    statusAt: timestamp("status_at"),
    appliedAt: timestamp("applied_at"),
    // Pipeline progress. DB default is "done" so rows written by older code (which only inserted finished
    // jobs) read as complete; new inserts set "queued" explicitly.
    stage: text("stage").$type<JobStage>().notNull().default("done"),
    error: text("error"),
    coverPrompt: text("cover_prompt").notNull().default(""),
    coverLetter: jsonb("cover_letter").$type<string[]>(),
    coverStage: text("cover_stage").$type<CoverStage>().notNull().default("idle"),
    coverError: text("cover_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("job_user_created_idx").on(t.userId, t.createdAt)],
);

export type Job = typeof job.$inferSelect;
