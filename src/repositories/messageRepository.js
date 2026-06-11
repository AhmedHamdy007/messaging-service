const crypto = require("crypto");
const { pool, query } = require("../db/pool");
const { encodeMessageBody, decodeMessageBody } = require("../utils/messageEncoding");

function rowToMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderUserId: row.sender_user_id,
    senderDisplayName: row.sender_display_name,
    senderUserRole: row.sender_user_role,
    body: decodeMessageBody(row.body),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at,
  };
}

async function findMessageById(messageId) {
  const result = await query(
    `SELECT m.*, cp.display_name AS sender_display_name, cp.user_role AS sender_user_role
     FROM messages m
     LEFT JOIN conversation_participants cp
       ON cp.conversation_id = m.conversation_id
      AND cp.user_id = m.sender_user_id
     WHERE m.id = $1
     LIMIT 1`,
    [messageId]
  );
  return rowToMessage(result.rows[0]);
}

async function listMessagesByConversationId(conversationId, { limit = 100 } = {}) {
  const result = await query(
    `SELECT m.*, cp.display_name AS sender_display_name, cp.user_role AS sender_user_role
     FROM messages m
     LEFT JOIN conversation_participants cp
       ON cp.conversation_id = m.conversation_id
      AND cp.user_id = m.sender_user_id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at ASC
     LIMIT $2`,
    [conversationId, limit]
  );
  return result.rows.map(rowToMessage);
}

async function appendMessageToConversation({ conversationId, senderUserId, body }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const messageInsert = await client.query(
      `INSERT INTO messages (id, conversation_id, sender_user_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [crypto.randomUUID(), conversationId, senderUserId, encodeMessageBody(body)]
    );
    const message = messageInsert.rows[0];

    await client.query(
      `UPDATE conversations
       SET last_message_at = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [message.created_at, conversationId]
    );

    await client.query(
      `UPDATE conversation_participants
       SET archived_at = NULL,
           last_read_message_id = CASE WHEN user_id = $1 THEN $2 ELSE last_read_message_id END,
           last_read_at = CASE WHEN user_id = $1 THEN $3 ELSE last_read_at END,
           updated_at = NOW()
       WHERE conversation_id = $4`,
      [senderUserId, message.id, message.created_at, conversationId]
    );

    const withSender = await client.query(
      `SELECT m.*, cp.display_name AS sender_display_name, cp.user_role AS sender_user_role
       FROM messages m
       LEFT JOIN conversation_participants cp
         ON cp.conversation_id = m.conversation_id
        AND cp.user_id = m.sender_user_id
       WHERE m.id = $1
       LIMIT 1`,
      [message.id]
    );

    await client.query("COMMIT");
    return rowToMessage(withSender.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateMessageBodyById(messageId, body) {
  const result = await query(
    `UPDATE messages
     SET body = $1,
         edited_at = NOW(),
         updated_at = NOW()
     WHERE id = $2
     RETURNING id`,
    [encodeMessageBody(body), messageId]
  );
  if (!result.rows[0]) return null;
  return findMessageById(result.rows[0].id);
}

async function markConversationReadUpToMessage({ conversationId, userId, messageId }) {
  const messageResult = await query(
    `SELECT id, created_at
     FROM messages
     WHERE id = $1
       AND conversation_id = $2
     LIMIT 1`,
    [messageId, conversationId]
  );

  if (!messageResult.rows[0]) return null;

  const targetMessage = messageResult.rows[0];
  const participantResult = await query(
    `UPDATE conversation_participants
     SET last_read_message_id = $1,
         last_read_at = $2,
         updated_at = NOW()
     WHERE conversation_id = $3
       AND user_id = $4
     RETURNING *`,
    [targetMessage.id, targetMessage.created_at, conversationId, userId]
  );

  return participantResult.rows[0]
    ? {
        conversationId: participantResult.rows[0].conversation_id,
        userId: participantResult.rows[0].user_id,
        lastReadMessageId: participantResult.rows[0].last_read_message_id,
        lastReadAt: participantResult.rows[0].last_read_at,
      }
    : null;
}

module.exports = {
  findMessageById,
  listMessagesByConversationId,
  appendMessageToConversation,
  updateMessageBodyById,
  markConversationReadUpToMessage,
};
