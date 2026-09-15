-- 004_session.sql — the table express-session's Postgres store reads and writes.
--
-- This is connect-pg-simple's own table.sql (v10.0.0), copied rather than left
-- to the store. With createTableIfMissing the running server would issue
-- CREATE TABLE on first use from a file inside node_modules, and the schema
-- would change outside the numbered migrations. The store is configured with
-- createTableIfMissing: false, so this file is the only thing that creates it.
--
-- Column names and types are the store's contract and stay as upstream has
-- them: it queries sid, sess and expire by name, and compares expire against
-- to_timestamp(). The one line dropped is WITH (OIDS=FALSE), which has been the
-- only behaviour since Postgres 12.
--
-- Rows are disposable. Expired sessions are pruned by the store itself, and
-- losing the table's contents logs everyone out without losing any league data.

CREATE TABLE "session" (
  "sid"    varchar      NOT NULL COLLATE "default",
  "sess"   json         NOT NULL,
  "expire" timestamp(6) NOT NULL
);

ALTER TABLE "session"
  ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX "IDX_session_expire" ON "session" ("expire");
