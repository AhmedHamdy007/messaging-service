const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const config = require("../config");

function readRequiredKey(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`JWT public key file not found at ${resolved}`);
  }
  return fs.readFileSync(resolved, "utf8");
}

const publicKey = readRequiredKey(config.jwtPublicKeyPath);

async function fetchCurrentUser(req) {
  const upstream = await fetch(`${config.authServiceUrl}/users/me`, {
    method: "GET",
    headers: {
      authorization: req.headers.authorization || "",
      "x-request-id": req.id || "",
    },
  });

  if (upstream.status !== 200) return null;
  const body = await upstream.json();
  return body?.data || null;
}

function requireAuth(req, res, next) {
  return (async () => {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Missing bearer token",
        request_id: req.id,
      });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    try {
      req.auth = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
      });
    } catch {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired token",
        request_id: req.id,
      });
    }

    const user = await fetchCurrentUser(req);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Unable to resolve current user",
        request_id: req.id,
      });
    }

    req.user = {
      ...user,
      id: user.id || req.auth.sub,
      role: req.auth.role || null,
    };
    return next();
  })().catch(() =>
    res.status(503).json({
      success: false,
      error: "Auth service unavailable",
      request_id: req.id,
    })
  );
}

module.exports = {
  requireAuth,
};
