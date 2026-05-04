const { getChannel } = require("./broker");

const EXCHANGE = "salon.events";
const DLX = "salon.events.dlx";

async function subscribe(routingKey, queueName, handler) {
  const channel = await getChannel();
  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  await channel.assertQueue(queueName, {
    durable: true,
    deadLetterExchange: DLX,
    deadLetterRoutingKey: "#",
  });
  await channel.bindQueue(queueName, EXCHANGE, routingKey);

  await channel.consume(
    queueName,
    async (msg) => {
      if (!msg) return;
      let settled = false;
      const ack = () => {
        if (settled) return;
        settled = true;
        channel.ack(msg);
      };
      const nack = (error) => {
        if (settled) return;
        settled = true;
        const errorMessage = error?.message || "handler requested nack";
        console.warn(JSON.stringify({
          timestamp: new Date().toISOString(),
          service: "event-subscriber",
          level: "WARN",
          message: "Nacking event message",
          routing_key: routingKey,
          queue_name: queueName,
          error: errorMessage,
        }));
        channel.nack(msg, false, false);
      };

      try {
        const payload = JSON.parse(msg.content.toString("utf8"));
        await handler(payload, ack, nack);
      } catch (error) {
        nack(error);
      }
    },
    { noAck: false }
  );
}

module.exports = { subscribe };
