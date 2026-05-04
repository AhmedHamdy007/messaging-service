CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_created_at
  ON messages (conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_messages_sender_user_id
  ON messages (sender_user_id, created_at DESC);
