const crypto = require("crypto");
const { pool, query } = require("../db/pool");

function rowToConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationKey: row.conversation_key,
    conversationType: row.conversation_type,
    shopId: row.shop_id,
    createdByUserId: row.created_by_user_id,
    lastMessageAt: row.last_message_at,
    archivedAt: row.archived_at,
    lastReadAt: row.last_read_at,
    lastReadMessageId: row.last_read_message_id,
    unreadCount:
      row.unread_count === undefined || row.unread_count === null ? undefined : Number(row.unread_count),
    otherParticipant:
      row.other_user_id === undefined
        ? undefined
        : {
            userId: row.other_user_id,
            role: row.other_user_role,
            displayName: row.other_display_name,
          },
    lastMessage:
      row.last_message_id === undefined || row.last_message_id === null
        ? null
        : {
            id: row.last_message_id,
            body: row.last_message_body,
            senderUserId: row.last_message_sender_user_id,
            createdAt: row.last_message_created_at,
          },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToParticipant(row) {
  if (!row) return null;
  return {
    conversationId: row.conversation_id,
    userId: row.user_id,
    userRole: row.user_role,
    displayName: row.display_name,
    archivedAt: row.archived_at,
    lastReadMessageId: row.last_read_message_id,
    lastReadAt: row.last_read_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findConversationById(conversationId) {
  const result = await query("SELECT * FROM conversations WHERE id = $1 LIMIT 1", [conversationId]);
  return rowToConversation(result.rows[0]);
}

async function findConversationByKey(conversationKey) {
  const result = await query(
    "SELECT * FROM conversations WHERE conversation_key = $1 LIMIT 1",
    [conversationKey]
  );
  return rowToConversation(result.rows[0]);
}

async function findConversationForUser(conversationId, userId) {
  const result = await query(
    `SELECT c.*, cp.archived_at, cp.last_read_at, cp.last_read_message_id
     FROM conversations c
     INNER JOIN conversation_participants cp
       ON cp.conversation_id = c.id
     WHERE c.id = $1
       AND cp.user_id = $2
     LIMIT 1`,
    [conversationId, userId]
  );
  return rowToConversation(result.rows[0]);
}

async function listParticipantsByConversationId(conversationId) {
  const result = await query(
    `SELECT *
     FROM conversation_participants
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );
  return result.rows.map(rowToParticipant);
}

async function listConversationsForUser(userId, { limit = 20 } = {}) {
  const result = await query(
    `SELECT c.*, cp.archived_at, cp.last_read_at, cp.last_read_message_id,
            op.user_id AS other_user_id,
            op.user_role AS other_user_role,
            op.display_name AS other_display_name,
            lm.id AS last_message_id,
            lm.body AS last_message_body,
            lm.sender_user_id AS last_message_sender_user_id,
            lm.created_at AS last_message_created_at,
            (
              SELECT COUNT(*)::int
              FROM messages m2
              WHERE m2.conversation_id = c.id
                AND m2.sender_user_id <> $1
                AND (cp.last_read_at IS NULL OR m2.created_at > cp.last_read_at)
            ) AS unread_count
     FROM conversation_participants cp
     INNER JOIN conversations c
       ON c.id = cp.conversation_id
     LEFT JOIN conversation_participants op
       ON op.conversation_id = c.id
      AND op.user_id <> $1
     LEFT JOIN LATERAL (
       SELECT m.id, m.body, m.sender_user_id, m.created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE cp.user_id = $1
       AND cp.archived_at IS NULL
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows.map(rowToConversation);
}

async function getConversationSummaryForUser(conversationId, userId) {
  const result = await query(
    `SELECT c.*, cp.archived_at, cp.last_read_at, cp.last_read_message_id,
            op.user_id AS other_user_id,
            op.user_role AS other_user_role,
            op.display_name AS other_display_name,
            lm.id AS last_message_id,
            lm.body AS last_message_body,
            lm.sender_user_id AS last_message_sender_user_id,
            lm.created_at AS last_message_created_at,
            (
              SELECT COUNT(*)::int
              FROM messages m2
              WHERE m2.conversation_id = c.id
                AND m2.sender_user_id <> $2
                AND (cp.last_read_at IS NULL OR m2.created_at > cp.last_read_at)
            ) AS unread_count
     FROM conversations c
     INNER JOIN conversation_participants cp
       ON cp.conversation_id = c.id
      AND cp.user_id = $2
     LEFT JOIN conversation_participants op
       ON op.conversation_id = c.id
      AND op.user_id <> $2
     LEFT JOIN LATERAL (
       SELECT m.id, m.body, m.sender_user_id, m.created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     WHERE c.id = $1
     LIMIT 1`,
    [conversationId, userId]
  );
  return rowToConversation(result.rows[0]);
}

async function createConversationWithParticipants({
  conversationKey,
  conversationType,
  shopId,
  createdByUserId,
  participants,
  initialMessage,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT * FROM conversations WHERE conversation_key = $1 LIMIT 1",
      [conversationKey]
    );
    if (existing.rowCount > 0) {
      await client.query("COMMIT");
      return { conversation: rowToConversation(existing.rows[0]), created: false, message: null };
    }

    const conversationInsert = await client.query(
      `INSERT INTO conversations (id, conversation_key, conversation_type, shop_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [crypto.randomUUID(), conversationKey, conversationType, shopId, createdByUserId]
    );
    const conversation = rowToConversation(conversationInsert.rows[0]);

    for (const participant of participants) {
      await client.query(
        `INSERT INTO conversation_participants (
          conversation_id, user_id, user_role, display_name, archived_at, last_read_message_id, last_read_at
        ) VALUES ($1, $2, $3, $4, NULL, NULL, NULL)`,
        [conversation.id, participant.userId, participant.userRole, participant.displayName]
      );
    }

    let createdMessage = null;
    if (initialMessage) {
      const messageInsert = await client.query(
        `INSERT INTO messages (id, conversation_id, sender_user_id, body)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [crypto.randomUUID(), conversation.id, createdByUserId, initialMessage]
      );
      createdMessage = messageInsert.rows[0];

      await client.query(
        `UPDATE conversations
         SET last_message_at = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [createdMessage.created_at, conversation.id]
      );

      await client.query(
        `UPDATE conversation_participants
         SET archived_at = NULL,
             last_read_message_id = CASE WHEN user_id = $1 THEN $2 ELSE last_read_message_id END,
             last_read_at = CASE WHEN user_id = $1 THEN $3 ELSE last_read_at END,
             updated_at = NOW()
         WHERE conversation_id = $4`,
        [createdByUserId, createdMessage.id, createdMessage.created_at, conversation.id]
      );
    }

    await client.query("COMMIT");
    return {
      conversation: createdMessage
        ? { ...conversation, lastMessageAt: createdMessage.created_at }
        : conversation,
      created: true,
      message: createdMessage,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      const existing = await findConversationByKey(conversationKey);
      return { conversation: existing, created: false, message: null };
    }
    throw error;
  } finally {
    client.release();
  }
}

async function getConversationSummariesForParticipants(conversationId, userIds) {
  const result = await query(
    `SELECT cp.user_id AS for_user_id, c.*,
            cp.archived_at, cp.last_read_at, cp.last_read_message_id,
            op.user_id AS other_user_id,
            op.user_role AS other_user_role,
            op.display_name AS other_display_name,
            lm.id AS last_message_id,
            lm.body AS last_message_body,
            lm.sender_user_id AS last_message_sender_user_id,
            lm.created_at AS last_message_created_at,
            (
              SELECT COUNT(*)::int
              FROM messages m2
              WHERE m2.conversation_id = c.id
                AND m2.sender_user_id <> cp.user_id
                AND (cp.last_read_at IS NULL OR m2.created_at > cp.last_read_at)
            ) AS unread_count
     FROM conversation_participants cp
     INNER JOIN conversations c ON c.id = cp.conversation_id
     LEFT JOIN conversation_participants op
       ON op.conversation_id = c.id AND op.user_id <> cp.user_id
     LEFT JOIN LATERAL (
       SELECT m.id, m.body, m.sender_user_id, m.created_at
       FROM messages m WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC LIMIT 1
     ) lm ON true
     WHERE c.id = $1 AND cp.user_id = ANY($2)`,
    [conversationId, userIds]
  );
  return result.rows.map((row) => ({
    forUserId: row.for_user_id,
    summary: rowToConversation(row),
  }));
}

async function archiveConversationForUser(conversationId, userId) {
  const result = await query(
    `UPDATE conversation_participants
     SET archived_at = NOW(),
         updated_at = NOW()
     WHERE conversation_id = $1
       AND user_id = $2
     RETURNING *`,
    [conversationId, userId]
  );
  return rowToParticipant(result.rows[0]);
}

module.exports = {
  findConversationById,
  findConversationByKey,
  findConversationForUser,
  listParticipantsByConversationId,
  listConversationsForUser,
  getConversationSummaryForUser,
  getConversationSummariesForParticipants,
  createConversationWithParticipants,
  archiveConversationForUser,
};
