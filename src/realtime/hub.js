function encodeEvent(type, data) {
  return JSON.stringify({
    type,
    data,
    sentAt: new Date().toISOString(),
  });
}

class RealtimeHub {
  constructor({ logger }) {
    this.logger = logger;
    this.connectionsByUserId = new Map();
  }

  registerConnection(ws, user) {
    const userId = String(user.id);
    const entry = this.connectionsByUserId.get(userId) || new Set();
    entry.add(ws);
    this.connectionsByUserId.set(userId, entry);

    this.logger.info("Realtime client connected", {
      userId,
      connectionCount: entry.size,
    });

    const cleanup = () => {
      const active = this.connectionsByUserId.get(userId);
      if (!active) return;
      active.delete(ws);
      if (active.size === 0) {
        this.connectionsByUserId.delete(userId);
      }
      this.logger.info("Realtime client disconnected", {
        userId,
        connectionCount: active.size,
      });
    };

    ws.on("close", cleanup);
    ws.on("error", cleanup);

    return cleanup;
  }

  emitToUser(userId, type, data) {
    const sockets = this.connectionsByUserId.get(String(userId));
    if (!sockets?.size) return;

    const payload = encodeEvent(type, data);
    for (const socket of sockets) {
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }
  }

  emitToUsers(userIds, type, data) {
    const uniqueUserIds = [...new Set((userIds || []).map((value) => String(value)))];
    uniqueUserIds.forEach((userId) => this.emitToUser(userId, type, data));
  }
}

module.exports = {
  RealtimeHub,
};
