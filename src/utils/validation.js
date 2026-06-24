class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

const CONVERSATION_TYPES = ["customer_stylist", "owner_stylist", "customer_owner", "stylist_stylist"];
const RECIPIENT_TYPES = ["stylist", "salon"];

function validateOptionalString(name, value, { maxLength = 255 } = {}) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${name} must be a string`, name);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${name} exceeds max length ${maxLength}`, name);
  }
  return trimmed;
}

function validateRequiredString(name, value, { maxLength = 255 } = {}) {
  const normalized = validateOptionalString(name, value, { maxLength });
  if (!normalized) {
    throw new ValidationError(`${name} is required`, name);
  }
  return normalized;
}

function validateIdentifier(name, value, { maxLength = 120 } = {}) {
  if (value === undefined || value === null || value === "") {
    throw new ValidationError(`${name} is required`, name);
  }
  const normalized = String(value).trim();
  if (!normalized) {
    throw new ValidationError(`${name} is required`, name);
  }
  if (normalized.length > maxLength) {
    throw new ValidationError(`${name} exceeds max length ${maxLength}`, name);
  }
  return normalized;
}

function validateConversationType(value) {
  const normalized = validateRequiredString("conversationType", value, { maxLength: 40 }).toLowerCase();
  if (!CONVERSATION_TYPES.includes(normalized)) {
    throw new ValidationError(
      `conversationType must be one of: ${CONVERSATION_TYPES.join(", ")}`,
      "conversationType"
    );
  }
  return normalized;
}

function validateListLimit(rawValue, { defaultValue = 20, max = 100 } = {}) {
  if (rawValue === undefined) return defaultValue;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ValidationError(`limit must be an integer between 1 and ${max}`, "limit");
  }
  return parsed;
}

function normalizeCreateConversationPayload(body) {
  const recipientId =
    body.recipientId === undefined || body.recipientId === null || body.recipientId === ""
      ? null
      : validateIdentifier("recipientId", body.recipientId, { maxLength: 120 });
  const recipientType = validateOptionalString("recipientType", body.recipientType, { maxLength: 40 });

  if (recipientType && !RECIPIENT_TYPES.includes(recipientType.toLowerCase())) {
    throw new ValidationError(`recipientType must be one of: ${RECIPIENT_TYPES.join(", ")}`, "recipientType");
  }

  const targetUserId =
    body.targetUserId === undefined || body.targetUserId === null || body.targetUserId === ""
      ? recipientId
      : body.targetUserId;

  return {
    conversationType: body.conversationType ? validateConversationType(body.conversationType) : null,
    targetUserId: validateIdentifier("targetUserId", targetUserId, { maxLength: 120 }),
    recipientType: recipientType ? recipientType.toLowerCase() : null,
    initialMessage: validateOptionalString("initialMessage", body.initialMessage, { maxLength: 4000 }),
  };
}

function normalizeSendMessagePayload(body) {
  return {
    body: validateRequiredString("body", body.body, { maxLength: 4000 }),
  };
}

function normalizeEditMessagePayload(body) {
  return {
    body: validateRequiredString("body", body.body, { maxLength: 4000 }),
  };
}

function sameId(a, b) {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return String(a) === String(b);
}

function buildConversationKey({ conversationType, shopId = null, participantUserIds }) {
  const normalizedIds = participantUserIds.map((value) => String(value)).sort();
  return [conversationType, shopId || "direct", ...normalizedIds].join(":");
}

module.exports = {
  ValidationError,
  CONVERSATION_TYPES,
  validateOptionalString,
  validateRequiredString,
  validateIdentifier,
  validateConversationType,
  validateListLimit,
  normalizeCreateConversationPayload,
  normalizeSendMessagePayload,
  normalizeEditMessagePayload,
  sameId,
  buildConversationKey,
};
