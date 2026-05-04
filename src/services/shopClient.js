const config = require("../config");

async function getMessagingContext({
  conversationType,
  initiatorUserId,
  initiatorRole,
  targetUserId,
  targetRole,
  requestId,
}) {
  const params = new URLSearchParams({
    conversationType,
    initiatorUserId: String(initiatorUserId),
    initiatorRole: String(initiatorRole),
    targetUserId: String(targetUserId),
    targetRole: String(targetRole),
  });

  const upstream = await fetch(`${config.shopServiceUrl}/internal/messaging-context?${params.toString()}`, {
    method: "GET",
    headers: {
      "x-request-id": requestId || "",
    },
  });

  const body = await upstream.json().catch(() => ({}));
  return {
    status: upstream.status,
    body,
  };
}

module.exports = {
  getMessagingContext,
};
