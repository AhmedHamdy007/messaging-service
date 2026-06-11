const ENCODED_PREFIX = "__salon_utf8_b64__:";

function encodeMessageBody(body) {
  return `${ENCODED_PREFIX}${Buffer.from(String(body), "utf8").toString("base64")}`;
}

function decodeMessageBody(body) {
  if (typeof body !== "string" || !body.startsWith(ENCODED_PREFIX)) {
    return body;
  }

  try {
    return Buffer.from(body.slice(ENCODED_PREFIX.length), "base64").toString("utf8");
  } catch {
    return body;
  }
}

module.exports = {
  encodeMessageBody,
  decodeMessageBody,
};
