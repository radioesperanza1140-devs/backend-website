import type { Context } from "koa";
import crypto from "crypto";

export default {
  /**
   * Handles incoming Bold webhook events (SALE_APPROVED, SALE_REJECTED, etc.)
   * POST /api/bold-webhook
   */
  async handleBoldEvent(ctx: Context) {
    const service = strapi.service('api::bold-webhook.bold-webhook') as any;

    const startTime = Date.now();
    strapi.log.info('═══════════════════════════════════════════════════════════');
    strapi.log.info('[BoldWebhook][Controller] ▶ WEBHOOK RECIBIDO');
    strapi.log.info(`[BoldWebhook][Controller] Timestamp: ${new Date().toISOString()}`);
    strapi.log.info(`[BoldWebhook][Controller] Headers relevantes: ${JSON.stringify({
      'content-type': ctx.request.headers['content-type'],
      'x-bold-signature': ctx.request.headers['x-bold-signature'] ? `${(ctx.request.headers['x-bold-signature'] as string).substring(0, 16)}...` : 'AUSENTE',
      'user-agent': ctx.request.headers['user-agent'],
      'x-forwarded-for': ctx.request.headers['x-forwarded-for'],
    })}`);

    try {
      // 1. Obtener raw body desde koa-body (includeUnparsed) o middleware legacy
      const unparsedSymbol = Symbol.for('unparsedBody');
      const unparsedBody = (ctx.request.body as any)?.[unparsedSymbol];
      const legacyRawBody = (ctx.request as any).rawBody;
      const rawBody: Buffer | string = unparsedBody ?? legacyRawBody ?? JSON.stringify(ctx.request.body);
      const boldSignature = ctx.request.headers['x-bold-signature'] as string;

      const rawBodySource = unparsedBody ? 'koa-body(unparsed)' : legacyRawBody ? 'middleware' : 'JSON.stringify(fallback)';
      strapi.log.info(
        `[BoldWebhook][Controller] Paso 1: Validar firma | rawBody source=${rawBodySource} | ` +
        `rawBody tipo=${typeof rawBody} | rawBody bytes=${Buffer.isBuffer(rawBody) ? rawBody.length : rawBody.length} | ` +
        `firma recibida=${boldSignature ? boldSignature.substring(0, 16) + '...' : 'NULA'}`
      );

      if (!service.validateSignature(rawBody, boldSignature)) {
        strapi.log.error('[BoldWebhook][Controller] ✗ FIRMA INVÁLIDA — respondiendo 401');
        strapi.log.error(`[BoldWebhook][Controller] Firma completa recibida: ${boldSignature ?? 'null'}`);
        strapi.log.info('═══════════════════════════════════════════════════════════');
        ctx.status = 401;
        ctx.body = { error: 'Invalid or missing signature' };
        return;
      }
      strapi.log.info('[BoldWebhook][Controller] ✓ Firma válida');

      // 2. Validate payload structure
      const body = ctx.request.body;
      strapi.log.info(`[BoldWebhook][Controller] Paso 2: Validar payload | body keys=${Object.keys(body as any).join(', ')}`);
      strapi.log.info(`[BoldWebhook][Controller] Payload completo: ${JSON.stringify(body)}`);

      if (!service.validatePayload(body)) {
        strapi.log.warn('[BoldWebhook][Controller] ✗ PAYLOAD INVÁLIDO — respondiendo 400');
        strapi.log.warn(`[BoldWebhook][Controller] Detalle: id=${(body as any)?.id}, type=${(body as any)?.type}, subject=${(body as any)?.subject}, data=${!!(body as any)?.data}`);
        strapi.log.info('═══════════════════════════════════════════════════════════');
        ctx.status = 400;
        ctx.body = { error: 'Invalid payload' };
        return;
      }
      strapi.log.info(`[BoldWebhook][Controller] ✓ Payload válido | type=${(body as any).type} | subject=${(body as any).subject}`);

      // 3. Extract and upsert donation
      strapi.log.info('[BoldWebhook][Controller] Paso 3: Extraer datos y upsert');
      const donationData = service.extractDonationData(body);
      strapi.log.info(`[BoldWebhook][Controller] Datos extraídos: ${JSON.stringify({
        boldPaymentId: donationData.boldPaymentId,
        reference: donationData.reference,
        status: donationData.status,
        amount: donationData.amount,
        currency: donationData.currency,
        eventType: donationData.eventType,
        paymentMethod: donationData.paymentMethod,
        payerEmail: donationData.payerEmail,
      })}`);

      const result = await service.upsertDonation(donationData);

      const elapsed = Date.now() - startTime;
      strapi.log.info(
        `[BoldWebhook][Controller] ✓ RESULTADO: ${result.created ? 'CREADA' : 'ACTUALIZADA'} | ` +
        `donación id=${result.id} | type=${(body as any).type} | elapsed=${elapsed}ms`
      );
      strapi.log.info('═══════════════════════════════════════════════════════════');

      // 4. Always respond 200 to acknowledge receipt
      ctx.status = 200;
      ctx.body = { received: true };

    } catch (error) {
      const elapsed = Date.now() - startTime;
      strapi.log.error('[BoldWebhook][Controller] ✗ ERROR PROCESANDO EVENTO');
      strapi.log.error(`[BoldWebhook][Controller] Error: ${error instanceof Error ? error.message : String(error)}`);
      strapi.log.error(`[BoldWebhook][Controller] Stack: ${error instanceof Error ? error.stack : 'N/A'}`);
      strapi.log.error(`[BoldWebhook][Controller] elapsed=${elapsed}ms`);
      strapi.log.info('═══════════════════════════════════════════════════════════');
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
    strapi.log.info('───────────────────────────────────────────────────────────');
    strapi.log.info('[BoldWebhook][GetSignature] ▶ Solicitud de firma recibida');

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

    strapi.log.info(`[BoldWebhook][GetSignature] Datos recibidos: ${JSON.stringify({
      orderId, amount, currency, donorFullName,
      donorPhone: donorPhone ?? 'N/A',
      donorIdentification, donorIdentificationType,
      payerEmail: payerEmail ?? 'N/A',
    })}`);

    const secretKey = process.env.BOLD_SECRET_KEY;

    if (!secretKey) {
      strapi.log.error('[BoldWebhook][GetSignature] ✗ BOLD_SECRET_KEY no configurada');
      ctx.status = 500;
      ctx.body = { error: 'BOLD_SECRET_KEY no configurada' };
      return;
    }

    // Validar orderId y amount
    if (!orderId || typeof orderId !== 'string' || orderId.trim() === '') {
      strapi.log.warn(`[BoldWebhook][GetSignature] ✗ orderId inválido: "${orderId}"`);
      ctx.status = 400;
      ctx.body = { error: 'orderId es requerido' };
      return;
    }

    const amountNum = Math.round(Number(amount));
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      strapi.log.warn(`[BoldWebhook][GetSignature] ✗ amount inválido: "${amount}"`);
      ctx.status = 400;
      ctx.body = { error: 'amount debe ser un número mayor a 0' };
      return;
    }

    // Validar campos requeridos del donante
    if (!donorFullName || !donorIdentification || !donorIdentificationType) {
      strapi.log.warn('[BoldWebhook][GetSignature] ✗ Datos del donante incompletos');
      ctx.status = 400;
      ctx.body = { error: 'Datos del donante incompletos (nombre, identificación, tipo)' };
      return;
    }

    const service = strapi.service('api::bold-webhook.bold-webhook') as any;

    // Crear donación pendiente con datos del wizard
    strapi.log.info(`[BoldWebhook][GetSignature] Creando donación pendiente con reference=${orderId}`);
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

    strapi.log.info(
      `[BoldWebhook][GetSignature] ✓ Firma generada para orderId=${orderId} | ` +
      `amount=${amountStr} | currency=${currency} | hash=${hash.substring(0, 16)}...`
    );
    strapi.log.info('───────────────────────────────────────────────────────────');

    ctx.body = { integritySignature: hash, orderId };
  },
};
