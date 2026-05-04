const {
  getConversationSummariesForParticipants,
  listParticipantsByConversationId,
} = require("../repositories/conversationRepository");

async function emitConversationUpserts({ conversationId, participantIds, hub }) {
  const participants = await listParticipantsByConversationId(conversationId);
  const summaries = await getConversationSummariesForParticipants(conversationId, participantIds);

  for (const { forUserId, summary } of summaries) {
    if (!summary) continue;
    hub.emitToUser(forUserId, "conversation.upsert", {
      ...summary,
      participants,
    });
  }
}

async function emitMessageCreated({ conversationId, participantIds, message, hub }) {
  hub.emitToUsers(participantIds, "message.created", {
    conversationId,
    message,
  });

  // Defer conversation summary updates off the request hot path
  setImmediate(async () => {
    try {
      await emitConversationUpserts({ conversationId, participantIds, hub });
    } catch {
      // Summary push failure should not crash the process
    }
  });
}

async function emitMessageUpdated({ conversationId, participantIds, message, hub }) {
  hub.emitToUsers(participantIds, "message.updated", {
    conversationId,
    message,
  });

  // Defer conversation summary updates off the request hot path
  setImmediate(async () => {
    try {
      await emitConversationUpserts({ conversationId, participantIds, hub });
    } catch {
      // Summary push failure should not crash the process
    }
  });
}

function emitConversationRead({ conversationId, participantIds, readState, readerUserId, hub }) {
  hub.emitToUsers(participantIds, "conversation.read", {
    conversationId,
    readerUserId,
    lastReadMessageId: readState?.lastReadMessageId || null,
    lastReadAt: readState?.lastReadAt || null,
  });
}

function emitConversationArchived({ conversationId, userId, archivedAt, hub }) {
  hub.emitToUser(userId, "conversation.archived", {
    conversationId,
    archivedAt,
  });
}

module.exports = {
  emitConversationUpserts,
  emitMessageCreated,
  emitMessageUpdated,
  emitConversationRead,
  emitConversationArchived,
};
