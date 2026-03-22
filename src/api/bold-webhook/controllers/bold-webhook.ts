/**
 * bold-webhook controller
 *
 * Thin controller que solo maneja concerns HTTP:
 * - Extraer raw body para validacion de firma
 * - Delegar logica al servicio
 * - Retornar respuestas HTTP apropiadas
 *
 * Bold requiere respuesta HTTP 200 en menos de 2 segundos.
 */
import type { Context } from 'koa';

export default {
  /**
   * POST /api/bold-webhook
   * Recibe notificaciones de Bold sobre el estado de las transacciones.
   */
  async handleBoldEvent(ctx: Context) {
    const service = strapi.service('api::bold-webhook.bold-webhook') as any;
    const startTime = Date.now();

    try {
      // 1. Obtener raw body para validacion HMAC
      const rawBody = getRawBody(ctx);
      const boldSignature = ctx.request.headers['x-bold-signature'] as string;

      const rawBodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf-8') : rawBody;

      strapi.log.info(
        `[BoldWebhook] >> Evento recibido | ` +
        `ip=${ctx.request.ip} | ` +
        `rawBodyType=${Buffer.isBuffer(rawBody) ? 'Buffer' : typeof rawBody} | ` +
        `rawBodyLength=${Buffer.isBuffer(rawBody) ? rawBody.length : rawBody?.length ?? 0}`
      );
      strapi.log.info(`[BoldWebhook] x-bold-signature: ${boldSignature ?? 'AUSENTE'}`);
      strapi.log.info(`[BoldWebhook] Raw body de Bold: ${rawBodyString}`);

      if (!service.validateSignature(rawBody, boldSignature)) {
        strapi.log.warn(
          `[BoldWebhook] Firma invalida | ` +
          `signatureRecibida=${boldSignature} |` +
          `elapsed=${Date.now() - startTime}ms`
        );
        ctx.status = 401;
        ctx.body = { error: 'Invalid or missing signature' };
        return;
      }

      strapi.log.info('[BoldWebhook] Firma HMAC validada correctamente');

      // 2. Validar payload CloudEvents
      const body = ctx.request.body;
      if (!service.validatePayload(body)) {
        strapi.log.warn(
          `[BoldWebhook] Payload invalido | ` +
          `type=${(body as any)?.type} | ` +
          `id=${(body as any)?.id} | ` +
          `keys=${body ? Object.keys(body as object).join(',') : 'null'}`
        );
        ctx.status = 400;
        ctx.body = { error: 'Invalid payload' };
        return;
      }

      const event = body as any;
      strapi.log.info(
        `[BoldWebhook] Payload valido | ` +
        `eventId=${event.id} | ` +
        `type=${event.type} | ` +
        `paymentId=${event.data?.payment_id} | ` +
        `amount=${event.data?.amount?.total} ${event.data?.amount?.currency ?? 'COP'}`
      );

      // 3. Extraer datos y upsert
      const donationData = service.extractDonationData(body);
      strapi.log.info(
        `[BoldWebhook] Datos mapeados | ` +
        `reference=${donationData.reference} | ` +
        `status=${donationData.status} | ` +
        `method=${donationData.paymentMethod} | ` +
        `email=${donationData.payerEmail}`
      );

      const result = await service.upsertDonation(donationData);

      strapi.log.info(
        `[BoldWebhook] << Procesado OK | ` +
        `${result.created ? 'CREADA' : 'ACTUALIZADA'} donacion=${result.id} | ` +
        `eventType=${event.type} | ` +
        `paymentId=${donationData.boldPaymentId} | ` +
        `reference=${donationData.reference} | ` +
        `elapsed=${Date.now() - startTime}ms`
      );

      ctx.status = 200;
      ctx.body = { received: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      strapi.log.error(
        `[BoldWebhook] !! Error procesando webhook | ` +
        `error=${errorMsg} | ` +
        `elapsed=${Date.now() - startTime}ms`
      );
      if (errorStack) {
        strapi.log.error(`[BoldWebhook] Stack: ${errorStack}`);
      }
      // Siempre responder 200 para evitar reintentos innecesarios de Bold
      ctx.status = 200;
      ctx.body = { received: true };
    }
  },

  /**
   * POST /api/bold-webhook/get-signature
   * Genera la firma de integridad SHA-256 para Bold Checkout
   * y crea una donacion pendiente con datos del wizard.
   */
  async getSignature(ctx: Context) {
    const service = strapi.service('api::bold-webhook.bold-webhook') as any;
    const body = ctx.request.body;
    const startTime = Date.now();

    strapi.log.info(
      `[BoldSignature] >> Solicitud de firma | ` +
      `orderId=${(body as any)?.orderId} | ` +
      `amount=${(body as any)?.amount} | ` +
      `donor=${(body as any)?.donorFullName}`
    );

    const integrity = service.validateAndComputeIntegrity(body);
    if (!integrity) {
      strapi.log.warn(
        `[BoldSignature] Validacion fallida | ` +
        `orderId=${(body as any)?.orderId} | ` +
        `amount=${(body as any)?.amount} | ` +
        `secretKeyPresente=${!!process.env.BOLD_SECRET_KEY}`
      );
      ctx.status = 400;
      ctx.body = { error: 'Datos invalidos o BOLD_SECRET_KEY no configurada' };
      return;
    }

    const { orderId, amount, currency } = integrity;
    const {
      donorFullName,
      donorPhone,
      donorIdentification,
      donorIdentificationType,
      payerEmail,
    } = body as any;

    await service.createPendingDonation({
      donorFullName,
      donorPhone: donorPhone ?? '',
      donorIdentification,
      donorIdentificationType,
      amount,
      currency,
      payerEmail: payerEmail ?? '',
      reference: orderId,
      status: 'pending' as const,
    });

    strapi.log.info(
      `[BoldSignature] << Firma generada | ` +
      `orderId=${orderId} | ` +
      `amount=${amount} ${currency} | ` +
      `donor=${donorFullName} | ` +
      `elapsed=${Date.now() - startTime}ms`
    );

    ctx.body = { integritySignature: integrity.integritySignature, orderId };
  },
};

/**
 * Extrae el raw body del request para validacion HMAC.
 * Prioridad: koa-body unparsed > middleware rawBody > JSON.stringify fallback
 */
function getRawBody(ctx: Context): Buffer | string {
  const unparsedSymbol = Symbol.for('unparsedBody');
  const unparsedBody = (ctx.request.body as any)?.[unparsedSymbol];
  if (unparsedBody) return unparsedBody;

  const legacyRawBody = (ctx.request as any).rawBody;
  if (legacyRawBody) return legacyRawBody;

  return JSON.stringify(ctx.request.body);
}
