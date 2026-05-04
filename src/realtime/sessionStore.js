const crypto = require("crypto");

class RealtimeSessionStore {
  constructor({ ttlSeconds = 60 } = {}) {
    this.ttlMilliseconds = Math.max(5, ttlSeconds) * 1000;
    this.sessions = new Map();

    this.cleanupTimer = setInterval(() => this.purgeExpired(), 30 * 1000);
    this.cleanupTimer.unref?.();
  }

  issue(user) {
    const ticket = `${crypto.randomUUID()}-${crypto.randomBytes(12).toString("hex")}`;
    const expiresAt = Date.now() + this.ttlMilliseconds;
    this.sessions.set(ticket, {
      user,
      expiresAt,
    });

    return {
      ticket,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  consume(ticket) {
    if (!ticket || typeof ticket !== "string") return null;
    const session = this.sessions.get(ticket);
    if (!session) return null;

    this.sessions.delete(ticket);

    if (session.expiresAt <= Date.now()) {
      return null;
    }

    return session.user;
  }

  purgeExpired() {
    const now = Date.now();
    for (const [ticket, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(ticket);
      }
    }
  }
}

module.exports = {
  RealtimeSessionStore,
};
