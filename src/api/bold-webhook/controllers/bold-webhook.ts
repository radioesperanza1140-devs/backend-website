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
      // 1. Validate signature (rawBody es Buffer del middleware, igual que express.raw())
      const rawBody: Buffer | string =
        (ctx.request as any).rawBody ?? JSON.stringify(ctx.request.body);
      const boldSignature = ctx.request.headers['x-bold-signature'] as string;
      
      strapi.log.info('[BoldWebhook] Webhook recibido');
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
      // Siempre responder 200 para evitar reintentos de Bold (hasta 5 veces)
      ctx.status = 200;
      ctx.body = { received: true };
    }
  },

  /**
   * Generates the SHA-256 integrity signature for Bold Checkout
   * and creates a pending donation with donor info from the wizard.
   * POST /api/bold-webhook/get-signature
   */
  async getSignature(ctx: Context) {
    const {
      orderId,
      amount,
      currency,
      donorFullName,
      donorPhone,
      donorIdentification,
      donorIdentificationType,
      payerEmail,
    } = ctx.request.body as any;

    const secretKey = process.env.BOLD_SECRET_KEY;

    if (!secretKey) {
      ctx.status = 500;
      ctx.body = { error: 'BOLD_SECRET_KEY no configurada' };
      return;
    }

    // Validar orderId y amount
    if (!orderId || typeof orderId !== 'string' || orderId.trim() === '') {
      ctx.status = 400;
      ctx.body = { error: 'orderId es requerido' };
      return;
    }

    const amountNum = Math.round(Number(amount));
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      ctx.status = 400;
      ctx.body = { error: 'amount debe ser un número mayor a 0' };
      return;
    }

    // Validar campos requeridos del donante
    if (!donorFullName || !donorIdentification || !donorIdentificationType) {
      ctx.status = 400;
      ctx.body = { error: 'Datos del donante incompletos (nombre, identificación, tipo)' };
      return;
    }

    const service = strapi.service('api::bold-webhook.bold-webhook') as any;

    // Crear donación pendiente con datos del wizard
    await service.createPendingDonation({
      donorFullName,
      donorPhone: donorPhone ?? '',
      donorIdentification,
      donorIdentificationType,
      amount: amountNum,
      currency: currency ?? 'COP',
      payerEmail: payerEmail ?? '',
      reference: orderId,
      status: 'pending' as const,
    });

    // Generar firma de integridad para Bold Checkout
    const amountStr = String(amountNum);
    const data = `${orderId}${amountStr}${currency}${secretKey}`;
    const hash = crypto
      .createHash('sha256')
      .update(data)
      .digest('hex');

    ctx.body = { integritySignature: hash, orderId };
  },
};
