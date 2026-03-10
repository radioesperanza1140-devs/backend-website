import type { Context } from "koa";
import crypto from "crypto";

export default {
  /**
   * Handles incoming Bold webhook events (SALE_APPROVED, SALE_REJECTED, etc.)
   * POST /api/bold-webhook
   */
  async handleBoldEvent(ctx: Context) {
    const service = strapi.service('api::bold-webhook.bold-webhook') as any;

    try {
      // 1. Validate signature
      const rawBody: string =
        (ctx.request as any).rawBody ?? JSON.stringify(ctx.request.body);
      const boldSignature = ctx.request.headers['x-bold-signature'] as string;

      if (!service.validateSignature(rawBody, boldSignature)) {
        ctx.status = 401;
        ctx.body = { error: 'Invalid or missing signature' };
        return;
      }

      // 2. Validate payload structure
      const body = ctx.request.body;
      if (!service.validatePayload(body)) {
        strapi.log.warn('[BoldWebhook] Payload inválido recibido');
        ctx.status = 400;
        ctx.body = { error: 'Invalid payload' };
        return;
      }

      // 3. Extract and upsert donation
      const donationData = service.extractDonationData(body);
      const result = await service.upsertDonation(donationData);

      strapi.log.info(
        `[BoldWebhook] ${result.created ? 'Creada' : 'Actualizada'} donación id=${result.id} | type=${body.type}`
      );

      // 4. Always respond 200 to acknowledge receipt
      ctx.status = 200;
      ctx.body = { received: true };

    } catch (error) {
      strapi.log.error('[BoldWebhook] Error procesando evento:', error);
      ctx.status = 500;
      ctx.body = { error: 'Internal server error' };
    }
  },

  /**
   * Generates the SHA-256 integrity signature for Bold Checkout.
   * POST /api/bold-webhook/get-signature
   */
  async getSignature(ctx: Context) {
    const { orderId, amount, currency } = ctx.request.body as any;
    const secretKey = process.env.BOLD_SECRET_KEY;

    if (!secretKey) {
      ctx.status = 500;
      ctx.body = { error: 'BOLD_SECRET_KEY no configurada' };
      return;
    }

    // Ensure amount is a clean integer string (no decimals)
    const amountStr = String(Math.round(Number(amount)));

    // Bold integrity: {orderId}{amount}{currency}{secretKey}  (SHA-256 plain)
    const data = `${orderId}${amountStr}${currency}${secretKey}`;
    const hash = crypto
      .createHash('sha256')
      .update(data)
      .digest('hex');

    ctx.body = { integritySignature: hash, orderId };
  },
};
