import type { Context } from "koa";
import crypto from "crypto";

export default {
  async handleBoldEvent(ctx: Context) {
    try {
      const body = ctx.request.body;

      // Usar el body ya parseado por Strapi, re-serializado

      const boldSignature = ctx.request.headers["x-bold-signature"] as
        | string
        | undefined;

      const boldService = strapi.service("api::bold-webhook.bold-webhook");

      console.log(body);
      console.log(boldSignature);
      // 1. Validar firma
      const isValid = boldService.validateSignature(body, boldSignature);

      if (!isValid) {
        strapi.log.warn(`[BoldWebhook] Firma inválida | IP: ${ctx.request.ip}`);
        ctx.status = 401;
        ctx.body = { error: "Invalid signature" };
        return;
      }

      // 2. Validar estructura
      if (!boldService.validatePayload(body)) {
        strapi.log.warn("[BoldWebhook] Payload inválido");
        ctx.status = 400;
        ctx.body = { error: "Invalid payload structure" };
        return;
      }

      // 3. Extraer y persistir
      const donationData = boldService.extractDonationData(body);
      const result = await boldService.upsertDonation(donationData);

      strapi.log.info(
        `[BoldWebhook] OK | ${body.type} | payment: ${body.subject} | ` +
          `$${donationData.amount} ${donationData.currency} | ` +
          `${donationData.paymentMethod} | ${result.created ? "NUEVA" : "ACTUALIZADA"}`,
      );

      // 4. Responder 200 (Bold requiere < 2s)
      ctx.status = 200;
      ctx.body = { received: true };
    } catch (error) {
      strapi.log.error("[BoldWebhook] Error:", error);
      ctx.status = 500;
      ctx.body = { error: "Internal server error" };
    }
  },

  async getSignature(ctx: Context) {
    const { orderId, amount, currency } = ctx.request.body;
    const secretKey = process.env.BOLD_SECRET_KEY;
    console.log("Secret " + secretKey);
    if (!secretKey) {
      ctx.status = 500;
      ctx.body = { error: "BOLD_SECRET_KEY no configurada" };
      return;
    }

    // Bold requiere: {orderId}{amount}{currency}{secretKey}
    const data = `${orderId}${amount}${currency}${secretKey}`;

    console.log("[Bold Signature Debug]", {
      orderId,
      amount: amount,
      currency,
      secretKeyLast4: secretKey?.slice(-4), // solo últimos 4 chars por seguridad
      concatenated: `${orderId}${amount}${currency}${"*".repeat(secretKey?.length || 0)}`,
    });

    const hash = crypto
      .createHash("sha256") // <-- createHash, NO createHmac
      .update(data)
      .digest("hex");

    console.log("[Bold Signature Debug] hash:", hash);
    
    ctx.body = { integritySignature: hash, orderId };
  },
};
