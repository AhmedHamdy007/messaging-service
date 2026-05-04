CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('customer', 'owner', 'stylist')),
  display_name TEXT NOT NULL,
  archived_at TIMESTAMPTZ NULL,
  last_read_message_id UUID NULL,
  last_read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id
  ON conversation_participants (user_id, archived_at, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_role
  ON conversation_participants (user_role);
