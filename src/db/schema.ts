import { bigint, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const tokens = pgTable('tokens', {
  id: serial('id').primaryKey(),
  provider: varchar('provider', { length: 50 }).notNull().unique(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  tokenType: varchar('token_type', { length: 50 }).notNull(),
  scope: text('scope'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Token = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;
