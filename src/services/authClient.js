const config = require("../config");

async function getUserById({ userId, authorization, requestId }) {
  const upstream = await fetch(`${config.authServiceUrl}/users/${encodeURIComponent(userId)}`, {
    method: "GET",
    headers: {
      authorization: authorization || "",
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
  getUserById,
};
