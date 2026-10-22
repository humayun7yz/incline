-- Accounts, sign-in sessions and saved scan reports.

CREATE TABLE users (
  id             bigserial PRIMARY KEY,
  email          text NOT NULL UNIQUE,            -- stored trimmed and lower-case
  password_hash  text NOT NULL,                   -- scrypt$N$r$p$salt$hash, never the password
  plan           text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'agency')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

-- Only a SHA-256 of the cookie value is stored, so a leaked database
-- can't be used to take over live sessions.
CREATE TABLE sessions (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url              text NOT NULL,
  title            text NOT NULL DEFAULT '',
  violation_count  integer NOT NULL,
  result           jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_user_created_idx ON reports (user_id, created_at DESC);
