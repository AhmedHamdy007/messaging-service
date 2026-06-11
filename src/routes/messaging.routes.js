const express = require("express");
const { healthCheck } = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const {
  ValidationError,
  normalizeCreateConversationPayload,
  normalizeSendMessagePayload,
  normalizeEditMessagePayload,
  validateListLimit,
  sameId,
  buildConversationKey,
} = require("../utils/validation");
const { getUserById } = require("../services/authClient");
const { getMessagingContext } = require("../services/shopClient");
const {
  findConversationForUser,
  listParticipantsByConversationId,
  listConversationsForUser,
  getConversationSummaryForUser,
  createConversationWithParticipants,
  archiveConversationForUser,
} = require("../repositories/conversationRepository");
const {
  findMessageById,
  listMessagesByConversationId,
  appendMessageToConversation,
  updateMessageBodyById,
  markConversationReadUpToMessage,
} = require("../repositories/messageRepository");
const {
  emitConversationUpserts,
  emitMessageCreated,
  emitMessageUpdated,
  emitConversationRead,
  emitConversationArchived,
} = require("../realtime/emitters");
const { publish } = require("../events/publisher");
const { MESSAGING_MESSAGE_SENT } = require("../events/eventTypes");

const router = express.Router();

function conversationTypeMatchesRoles(conversationType, roleA, roleB) {
  const roles = [roleA, roleB].sort().join(":");
  if (conversationType === "customer_stylist") {
    return roles === ["customer", "stylist"].sort().join(":");
  }
  if (conversationType === "owner_stylist") {
    return roles === ["owner", "stylist"].sort().join(":");
  }
  if (conversationType === "customer_owner") {
    return roles === ["customer", "owner"].sort().join(":");
  }
  return false;
}

function inferConversationType({ initiatorRole, targetRole, recipientType }) {
  if (recipientType === "salon" && [initiatorRole, targetRole].sort().join(":") === "customer:owner") {
    return "customer_owner";
  }
  if ([initiatorRole, targetRole].sort().join(":") === "customer:stylist") {
    return "customer_stylist";
  }
  if ([initiatorRole, targetRole].sort().join(":") === "owner:stylist") {
    return "owner_stylist";
  }
  return null;
}

async function resolveTargetUser(req, targetUserId) {
  const upstream = await getUserById({
    userId: targetUserId,
    authorization: req.headers.authorization || "",
    requestId: req.id,
  });

  if (upstream.status === 404) return null;
  if (upstream.status !== 200) {
    throw new Error(`auth_lookup_failed:${upstream.status}`);
  }

  return upstream.body?.data || null;
}

async function ensureConversationMembership(req, res, conversationId) {
  const conversation = await findConversationForUser(conversationId, req.user.id);
  if (!conversation) {
    res.status(404).json({
      success: false,
      error: "Conversation not found",
      request_id: req.id,
    });
    return null;
  }
  return conversation;
}

async function listParticipantUserIds(conversationId) {
  const participants = await listParticipantsByConversationId(conversationId);
  return participants.map((participant) => participant.userId);
}

async function enrichParticipantsWithProfiles(req, participants) {
  return Promise.all(
    participants.map(async (participant) => {
      try {
        const upstream = await getUserById({
          userId: participant.userId,
          authorization: req.headers.authorization || "",
          requestId: req.id,
        });
        const profile = upstream.status === 200 ? upstream.body?.data : null;
        const avatarUrl = profile?.avatar?.url || profile?.profileImageUrl || null;

        return {
          ...participant,
          id: participant.userId,
          name: profile?.name || participant.displayName,
          role: profile?.role || participant.userRole,
          avatar: avatarUrl,
          profileImageUrl: avatarUrl,
        };
      } catch (error) {
        req.logger?.warn("Unable to enrich conversation participant", {
          request_id: req.id,
          user_id: participant.userId,
          error: error.message,
        });
        return {
          ...participant,
          id: participant.userId,
          name: participant.displayName,
          role: participant.userRole,
          avatar: null,
          profileImageUrl: null,
        };
      }
    })
  );
}

function toIsoString(value) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function recipientIdForParticipants(participantUserIds, senderId) {
  return participantUserIds.find((participantId) => !sameId(participantId, senderId)) || null;
}

async function publishMessageSentEvent(req, message, recipientId) {
  if (!message || !recipientId) return;
  try {
    await publish(MESSAGING_MESSAGE_SENT, {
      messageId: message.id,
      conversationId: message.conversationId,
      senderId: message.senderUserId,
      recipientId,
      sentAt: toIsoString(message.createdAt),
    });
  } catch (error) {
    req.logger?.error("Failed to publish messaging event", {
      request_id: req.id,
      routing_key: MESSAGING_MESSAGE_SENT,
      error: error.message,
    });
  }
}

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "messaging-service",
    timestamp: new Date().toISOString(),
  });
});

router.get("/ready", async (req, res) => {
  try {
    await healthCheck();
    return res.json({
      ready: true,
      service: "messaging-service",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(503).json({
      ready: false,
      service: "messaging-service",
      error: "Database unavailable",
      timestamp: new Date().toISOString(),
      request_id: req.id,
    });
  }
});

router.get("/conversations", requireAuth, async (req, res, next) => {
  try {
    const conversations = await listConversationsForUser(req.user.id, {
      limit: validateListLimit(req.query.limit),
    });
    return res.json({
      success: true,
      count: conversations.length,
      data: conversations,
      request_id: req.id,
    });
  } catch (error) {
    if (
      typeof error.message === "string" &&
      (error.message.startsWith("auth_lookup_failed:") ||
        error.message.startsWith("shop_messaging_context_failed:"))
    ) {
      return res.status(503).json({
        success: false,
        error: "Dependent service unavailable",
        request_id: req.id,
      });
    }
    return next(error);
  }
});

router.post("/conversations/realtime-sessions", requireAuth, async (req, res) => {
  const realtimeSession = req.app.locals.realtimeSessionStore.issue({
    id: req.user.id,
    role: req.user.role,
    name: req.user.name,
  });

  return res.status(201).json({
    success: true,
    data: {
      ...realtimeSession,
      websocketPath: "/ws/messaging",
    },
    request_id: req.id,
  });
});

router.post("/conversations", requireAuth, async (req, res, next) => {
  try {
    const payload = normalizeCreateConversationPayload(req.body);
    if (sameId(payload.targetUserId, req.user.id)) {
      throw new ValidationError("You cannot create a conversation with yourself", "targetUserId");
    }

    const targetUser = await resolveTargetUser(req, payload.targetUserId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: "Target user not found",
        request_id: req.id,
      });
    }

    const conversationType = payload.conversationType || inferConversationType({
      initiatorRole: req.user.role,
      targetRole: targetUser.role,
      recipientType: payload.recipientType,
    });

    if (!conversationType || !conversationTypeMatchesRoles(conversationType, req.user.role, targetUser.role)) {
      return res.status(403).json({
        success: false,
        error: "Conversation type is not allowed for these participants",
        request_id: req.id,
      });
    }

    const context = await getMessagingContext({
      conversationType,
      initiatorUserId: req.user.id,
      initiatorRole: req.user.role,
      targetUserId: targetUser.id,
      targetRole: targetUser.role,
      requestId: req.id,
    });

    if (context.status === 404) {
      return res.status(404).json({
        success: false,
        error: context.body?.error || "Messaging context not found",
        request_id: req.id,
      });
    }
    if (context.status === 403) {
      return res.status(403).json({
        success: false,
        error: context.body?.error || "Conversation is not allowed",
        request_id: req.id,
      });
    }
    if (context.status !== 200) {
      throw new Error(`shop_messaging_context_failed:${context.status}`);
    }

    const conversationKey = buildConversationKey({
      conversationType,
      shopId: context.body?.data?.shopId || null,
      participantUserIds: [req.user.id, targetUser.id],
    });

    const createResult = await createConversationWithParticipants({
      conversationKey,
      conversationType,
      shopId: context.body?.data?.shopId || null,
      createdByUserId: req.user.id,
      participants: [
        {
          userId: req.user.id,
          userRole: req.user.role,
          displayName: req.user.name,
        },
        {
          userId: targetUser.id,
          userRole: targetUser.role,
          displayName: targetUser.name,
        },
      ],
      initialMessage: payload.initialMessage,
    });

    let appendedInitialMessage = null;
    if (!createResult.created && payload.initialMessage) {
      appendedInitialMessage = await appendMessageToConversation({
        conversationId: createResult.conversation.id,
        senderUserId: req.user.id,
        body: payload.initialMessage,
      });
    }

    const conversation = await getConversationSummaryForUser(createResult.conversation.id, req.user.id);
    const participants = await listParticipantsByConversationId(createResult.conversation.id);
    const enrichedParticipants = await enrichParticipantsWithProfiles(req, participants);
    const participantUserIds = participants.map((participant) => participant.userId);

    const emittedMessage = createResult.message
      ? await findMessageById(createResult.message.id)
      : appendedInitialMessage;

    if (emittedMessage) {
      await emitMessageCreated({
        conversationId: createResult.conversation.id,
        participantIds: participantUserIds,
        message: emittedMessage,
        hub: req.app.locals.realtimeHub,
      });
      await publishMessageSentEvent(
        req,
        emittedMessage,
        recipientIdForParticipants(participantUserIds, req.user.id)
      );
    } else {
      await emitConversationUpserts({
        conversationId: createResult.conversation.id,
        participantIds: participantUserIds,
        hub: req.app.locals.realtimeHub,
      });
    }

    return res.status(createResult.created ? 201 : 200).json({
      success: true,
      data: {
        ...conversation,
        conversationId: createResult.conversation.id,
        participants: enrichedParticipants,
      },
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations/:conversationId", requireAuth, async (req, res, next) => {
  try {
    const membership = await ensureConversationMembership(req, res, req.params.conversationId);
    if (!membership) return;

    const conversation = await getConversationSummaryForUser(membership.id, req.user.id);
    const participants = await listParticipantsByConversationId(membership.id);
    const enrichedParticipants = await enrichParticipantsWithProfiles(req, participants);

    return res.json({
      success: true,
      data: {
        ...conversation,
        conversationId: conversation.id,
        participants: enrichedParticipants,
      },
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/conversations/:conversationId/archive", requireAuth, async (req, res, next) => {
  try {
    const membership = await ensureConversationMembership(req, res, req.params.conversationId);
    if (!membership) return;

    const archived = await archiveConversationForUser(membership.id, req.user.id);
    emitConversationArchived({
      conversationId: membership.id,
      userId: req.user.id,
      archivedAt: archived?.archivedAt || null,
      hub: req.app.locals.realtimeHub,
    });
    return res.json({
      success: true,
      data: archived,
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations/:conversationId/messages", requireAuth, async (req, res, next) => {
  try {
    const membership = await ensureConversationMembership(req, res, req.params.conversationId);
    if (!membership) return;

    const messages = await listMessagesByConversationId(membership.id, {
      limit: validateListLimit(req.query.limit, { defaultValue: 100, max: 200 }),
    });

    return res.json({
      success: true,
      count: messages.length,
      data: messages,
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/conversations/:conversationId/messages", requireAuth, async (req, res, next) => {
  try {
    const membership = await ensureConversationMembership(req, res, req.params.conversationId);
    if (!membership) return;

    const payload = normalizeSendMessagePayload(req.body);
    const message = await appendMessageToConversation({
      conversationId: membership.id,
      senderUserId: req.user.id,
      body: payload.body,
    });
    const participantUserIds = await listParticipantUserIds(membership.id);

    await emitMessageCreated({
      conversationId: membership.id,
      participantIds: participantUserIds,
      message,
      hub: req.app.locals.realtimeHub,
    });
    await publishMessageSentEvent(
      req,
      message,
      recipientIdForParticipants(participantUserIds, req.user.id)
    );

    return res.status(201).json({
      success: true,
      data: message,
      request_id: req.id,
    });
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/conversations/:conversationId/messages/:messageId",
  requireAuth,
  async (req, res, next) => {
    try {
      const membership = await ensureConversationMembership(req, res, req.params.conversationId);
      if (!membership) return;

      const message = await findMessageById(req.params.messageId);
      if (!message || !sameId(message.conversationId, membership.id)) {
        return res.status(404).json({
          success: false,
          error: "Message not found",
          request_id: req.id,
        });
      }

      if (!sameId(message.senderUserId, req.user.id)) {
        return res.status(403).json({
          success: false,
          error: "You can only edit your own messages",
          request_id: req.id,
        });
      }

      const payload = normalizeEditMessagePayload(req.body);
      const updated = await updateMessageBodyById(message.id, payload.body);
      const participantUserIds = await listParticipantUserIds(membership.id);

      await emitMessageUpdated({
        conversationId: membership.id,
        participantIds: participantUserIds,
        message: updated,
        hub: req.app.locals.realtimeHub,
      });
      return res.json({
        success: true,
        data: updated,
        request_id: req.id,
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  "/conversations/:conversationId/messages/:messageId/read",
  requireAuth,
  async (req, res, next) => {
    try {
      const membership = await ensureConversationMembership(req, res, req.params.conversationId);
      if (!membership) return;

      const message = await findMessageById(req.params.messageId);
      if (!message || !sameId(message.conversationId, membership.id)) {
        return res.status(404).json({
          success: false,
          error: "Message not found",
          request_id: req.id,
        });
      }

      const readState = await markConversationReadUpToMessage({
        conversationId: membership.id,
        userId: req.user.id,
        messageId: message.id,
      });
      const participantUserIds = await listParticipantUserIds(membership.id);

      emitConversationRead({
        conversationId: membership.id,
        participantIds: participantUserIds,
        readState,
        readerUserId: req.user.id,
        hub: req.app.locals.realtimeHub,
      });

      await emitConversationUpserts({
        conversationId: membership.id,
        participantIds: participantUserIds,
        hub: req.app.locals.realtimeHub,
      });

      return res.json({
        success: true,
        data: readState,
        request_id: req.id,
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
