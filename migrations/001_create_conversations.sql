CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  conversation_key TEXT NOT NULL UNIQUE,
  conversation_type TEXT NOT NULL CHECK (conversation_type IN ('customer_stylist', 'owner_stylist')),
  shop_id TEXT NULL,
  created_by_user_id TEXT NOT NULL,
  last_message_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations (conversation_type);
CREATE INDEX IF NOT EXISTS idx_conversations_shop_id ON conversations (shop_id) WHERE shop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations (last_message_at DESC NULLS LAST);
