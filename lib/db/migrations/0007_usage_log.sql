-- Up migration: recreate usage_log with correct uuid FK
DROP TABLE IF EXISTS "usage_log";

CREATE TABLE "usage_log" (
  "id" serial PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "model" text NOT NULL,
  "request_type" text NOT NULL,
  "prompt_tokens" integer NOT NULL,
  "completion_tokens" integer NOT NULL,
  "total_tokens" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "usage_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE
);

-- Down migration: drop table
DROP TABLE IF EXISTS "usage_log"; 