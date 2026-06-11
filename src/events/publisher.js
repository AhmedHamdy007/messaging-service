const { getChannel } = require("./broker");

const EXCHANGE = "salon.events";

function log(level, message, meta = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    service: "event-publisher",
    level,
    message,
    ...meta,
  };
  const output = JSON.stringify(payload);
  if (level === "ERROR") console.error(output);
  else if (level === "WARN") console.warn(output);
  else console.log(output);
}

async function dispatchToNotificationService(routingKey, payload) {
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL;
  if (!baseUrl) return false;

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/internal/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.INTERNAL_EVENT_TOKEN
        ? { "x-internal-event-token": process.env.INTERNAL_EVENT_TOKEN }
        : {}),
    },
    body: JSON.stringify({
      type: routingKey,
      payload,
    }),
  });

  if (!response.ok) {
    throw new Error(`notification-service returned ${response.status}`);
  }

  return true;
}

async function publish(routingKey, payload) {
  if (!process.env.RABBITMQ_URL) {
    if (await dispatchToNotificationService(routingKey, payload)) {
      log("INFO", "Dispatched event directly to notification-service", {
        routing_key: routingKey,
      });
      return;
    }

    log("WARN", "RabbitMQ URL missing and notification-service fallback is not configured", {
      routing_key: routingKey,
    });
    return;
  }

  const channel = await getChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  const body = Buffer.from(JSON.stringify(payload));
  const accepted = channel.publish(EXCHANGE, routingKey, body, {
    persistent: true,
    contentType: "application/json",
  });

  if (!accepted) {
    await new Promise((resolve) => channel.once("drain", resolve));
  }
}

module.exports = { publish };
