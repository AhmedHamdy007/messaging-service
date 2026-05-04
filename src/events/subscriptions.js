const { subscribe } = require("./subscriber");
const { BOOKING_CONFIRMED } = require("./eventTypes");
const { createConversationWithParticipants } = require("../repositories/conversationRepository");

function formatScheduledAt(value) {
  if (!value) return "the scheduled time";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString();
}

async function createBookingThread(payload) {
  return createConversationWithParticipants({
    conversationKey: `booking:${payload.bookingId}`,
    conversationType: "customer_stylist",
    shopId: payload.shopId,
    createdByUserId: payload.userId,
    participants: [
      {
        userId: payload.userId,
        userRole: "customer",
        displayName: "Customer",
      },
      {
        userId: payload.stylistId,
        userRole: "stylist",
        displayName: "Stylist",
      },
    ],
    initialMessage: `Booking ${payload.bookingId} confirmed for ${formatScheduledAt(payload.scheduledAt)}.`,
  });
}

async function initSubscriptions() {
  if (!process.env.RABBITMQ_URL) {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "event-subscriber",
      level: "WARN",
      message: "RABBITMQ_URL missing; messaging subscriptions disabled",
    }));
    return;
  }

  await subscribe(BOOKING_CONFIRMED, "messaging-service.bookings.confirmed", async (payload, ack, nack) => {
    try {
      await createBookingThread(payload);
      ack();
    } catch (error) {
      nack(error);
    }
  });
}

module.exports = { initSubscriptions };
