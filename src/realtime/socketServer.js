const { URL } = require("url");
const { WebSocketServer } = require("ws");
const { resolveAllowedOrigins } = require("../../../shared/http/httpSecurity");

function rejectUpgrade(socket, statusCode, message) {
  socket.write(
    `HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`
  );
  socket.destroy();
}

function createRealtimeSocketServer({
  server,
  logger,
  sessionStore,
  hub,
  nodeEnv,
  corsAllowedOrigins,
  path = "/ws/messaging",
}) {
  const allowedOrigins = resolveAllowedOrigins({ nodeEnv, corsAllowedOrigins });
  const socketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });

  const heartbeatTimer = setInterval(() => {
    socketServer.clients.forEach((client) => {
      if (client.isAlive === false) {
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  }, 30 * 1000);
  heartbeatTimer.unref?.();

  server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (requestUrl.pathname !== path) {
      return;
    }

    const origin = req.headers.origin;
    if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      logger.warn("Rejected realtime upgrade from untrusted origin", { origin });
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    if (origin && allowedOrigins.length === 0 && nodeEnv === "production") {
      logger.warn("Rejected realtime upgrade because no trusted origins are configured", {
        origin,
      });
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    const ticket = requestUrl.searchParams.get("ticket");
    const user = sessionStore.consume(ticket);
    if (!user) {
      logger.warn("Rejected realtime upgrade because ticket is invalid or expired");
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    socketServer.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on("pong", () => {
        ws.isAlive = true;
      });

      ws.on("message", (raw) => {
        try {
          const event = JSON.parse(raw.toString("utf8"));
          if (event?.type === "ping") {
            ws.send(
              JSON.stringify({
                type: "pong",
                data: null,
                sentAt: new Date().toISOString(),
              })
            );
          }
        } catch {
          ws.send(
            JSON.stringify({
              type: "error",
              data: { message: "Unsupported realtime payload" },
              sentAt: new Date().toISOString(),
            })
          );
        }
      });

      hub.registerConnection(ws, user);

      ws.send(
        JSON.stringify({
          type: "connection.ready",
          data: {
            user: {
              id: user.id,
              role: user.role,
              name: user.name,
            },
          },
          sentAt: new Date().toISOString(),
        })
      );
    });
  });

  return socketServer;
}

module.exports = {
  createRealtimeSocketServer,
};
