/**
 * bold-webhook service
 *
 * Lógica de negocio para procesar webhooks de Bold:
 * - Validación de firma HMAC-SHA256 (llave secreta)
 * - Extracción y mapeo de datos del evento CloudEvents de Bold
 * - Upsert de donaciones en la BD
 *
 * Ref: https://developers.bold.co/webhook
 */
import crypto from 'crypto';
import type {
  BoldWebhookEvent,
  BoldEventType,
  DonationStatus,
  DonationPendingData,
  DonationWebhookData,
} from '../types/bold-webhook';

// ─── Mapeo de eventos Bold → estado de donación ────────────────────────────

const EVENT_STATUS_MAP: Record<BoldEventType, DonationStatus> = {
  SALE_APPROVED: 'approved',
  SALE_REJECTED: 'rejected',
  VOID_APPROVED: 'voided',
  VOID_REJECTED: 'approved', // Si la anulación fue rechazada, la venta sigue aprobada
};

// ─── Servicio ───────────────────────────────────────────────────────────────

export default () => ({

  /**
   * Valida la firma HMAC-SHA256 del webhook de Bold.
   *
   * Proceso según la documentación oficial:
   * 1. Convertir el body recibido (string) a Base64
   * 2. Cifrar con HMAC-SHA256 usando la LLAVE SECRETA
   * 3. Comparar con el header `x-bold-signature`
   *
   * ⚠️ En modo pruebas, la llave secreta es un string vacío "".
   *
   * @param rawBody - El body crudo como string (tal como lo envió Bold)
   * @param receivedSignature - Valor del header x-bold-signature
   */
  validateSignature(rawBody: Buffer | string, receivedSignature: string | undefined): boolean {
    if (!receivedSignature) {
      strapi.log.warn('[BoldWebhook][Signature] No se recibió header x-bold-signature');
      return false;
    }

    // En producción usa BOLD_SECRET_KEY; en pruebas la llave es un string vacío
    const secretKey = process.env.BOLD_SECRET_KEY ?? '';

    strapi.log.info(
      `[BoldWebhook][Signature] BOLD_SECRET_KEY configurada=${secretKey.length > 0 ? 'SÍ' : 'NO (vacía)'} | ` +
      `longitud key=${secretKey.length}`
    );

    try {
      // Paso 1: Convertir el cuerpo recibido a formato Base64
      const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf-8');
      const encoded = body.toString('base64');

      strapi.log.info(
        `[BoldWebhook][Signature] Base64 del body (primeros 80 chars): ${encoded.substring(0, 80)}...`
      );

      // Paso 2: Cifrar con HMAC-SHA256 usando la llave secreta → hexadecimal
      const hashed = crypto
        .createHmac('sha256', secretKey)
        .update(encoded)
        .digest('hex');

      strapi.log.info(`[BoldWebhook][Signature] Hash calculado:  ${hashed}`);
      strapi.log.info(`[BoldWebhook][Signature] Firma recibida:  ${receivedSignature}`);
      strapi.log.info(`[BoldWebhook][Signature] ¿Coinciden (visual)? ${hashed === receivedSignature ? 'SÍ' : 'NO'}`);

      // Paso 3: Comparar con timingSafeEqual
      const isValid = crypto.timingSafeEqual(
        Buffer.from(hashed),
        Buffer.from(receivedSignature)
      );

      strapi.log.info(`[BoldWebhook][Signature] timingSafeEqual resultado: ${isValid}`);
      return isValid;
    } catch (error) {
      strapi.log.error(`[BoldWebhook][Signature] Error validando firma: ${error instanceof Error ? error.message : String(error)}`);
      strapi.log.error(`[BoldWebhook][Signature] Stack: ${error instanceof Error ? error.stack : 'N/A'}`);
      return false;
    }
  },

  /**
   * Valida que el payload tenga la estructura mínima esperada de Bold (CloudEvents).
   */
  validatePayload(body: unknown): body is BoldWebhookEvent {
    strapi.log.info('[BoldWebhook][Validate] Validando estructura del payload...');

    if (!body || typeof body !== 'object') {
      strapi.log.warn(`[BoldWebhook][Validate] ✗ body es nulo o no es objeto | typeof=${typeof body}`);
      return false;
    }

    const event = body as Record<string, unknown>;

    // Campos raíz obligatorios del CloudEvent
    if (!event.id || !event.type || !event.subject || !event.data) {
      strapi.log.warn(
        `[BoldWebhook][Validate] ✗ Campos raíz faltantes | ` +
        `id=${!!event.id} type=${!!event.type} subject=${!!event.subject} data=${!!event.data}`
      );
      return false;
    }

    // Validar que el type sea un evento conocido
    const validTypes: BoldEventType[] = [
      'SALE_APPROVED',
      'SALE_REJECTED',
      'VOID_APPROVED',
      'VOID_REJECTED',
    ];
    if (!validTypes.includes(event.type as BoldEventType)) {
      strapi.log.warn(`[BoldWebhook][Validate] ✗ Tipo de evento no reconocido: "${event.type}"`);
      return false;
    }

    // Validar campos mínimos dentro de data
    const data = event.data as Record<string, unknown>;
    if (!data.payment_id || !data.amount) {
      strapi.log.warn(
        `[BoldWebhook][Validate] ✗ Campos data faltantes | ` +
        `payment_id=${!!data.payment_id} amount=${!!data.amount}`
      );
      return false;
    }

    strapi.log.info(
      `[BoldWebhook][Validate] ✓ Payload válido | type=${event.type} | payment_id=${data.payment_id}`
    );
    return true;
  },

  /**
   * Extrae y mapea los datos del evento Bold a la estructura de Donation.
   *
   * Nota: `amount.total` de Bold ya viene en unidades (NO centavos).
   * Ejemplo: 59900 = $59.900 COP
   */
  extractDonationData(event: BoldWebhookEvent): DonationWebhookData {
    const { data } = event;

    return {
      boldPaymentId: data.payment_id,
      boldNotificationId: event.id,
      eventType: event.type,
      amount: data.amount.total,
      currency: data.amount.currency ?? 'COP',
      tip: data.amount.tip ?? 0,
      status: EVENT_STATUS_MAP[event.type] ?? 'pending',
      paymentMethod: data.payment_method ?? 'unknown',
      integration: data.integration ?? 'unknown',
      payerEmail: data.payer_email ?? '',
      cardBrand: data.card?.brand ?? '',
      cardMaskedPan: data.card?.masked_pan ?? '',
      reference: data.metadata?.reference ?? '',
      rawPayload: JSON.stringify(event),
    };
  },

  /**
   * Crea una donación pendiente con los datos del donante desde el wizard.
   * Se llama antes de iniciar el pago en Bold.
   */
  async createPendingDonation(
    donationData: DonationPendingData
  ): Promise<{ id: string; documentId: string }> {
    const uid = 'api::donation.donation' as const;

    strapi.log.info(
      `[BoldWebhook][CreatePending] Creando/actualizando donación pendiente | ` +
      `reference=${donationData.reference} | donor=${donationData.donorFullName} | ` +
      `amount=$${donationData.amount} ${donationData.currency}`
    );

    // Buscar donación pendiente existente con el mismo orderId para evitar duplicados
    const existing = await strapi.documents(uid).findMany({
      filters: { reference: donationData.reference, status: 'pending' },
      limit: 1,
    });

    strapi.log.info(
      `[BoldWebhook][CreatePending] Búsqueda por reference="${donationData.reference}" + status=pending → ` +
      `${existing?.length ?? 0} resultado(s)`
    );

    if (existing && existing.length > 0) {
      const record = existing[0];
      strapi.log.info(
        `[BoldWebhook][CreatePending] Encontrada existente: documentId=${record.documentId} | ` +
        `id=${record.id} | status=${record.status}`
      );

      await strapi.documents(uid).update({
        documentId: record.documentId,
        data: {
          donorFullName: donationData.donorFullName,
          donorPhone: donationData.donorPhone,
          donorIdentification: donationData.donorIdentification,
          donorIdentificationType: donationData.donorIdentificationType,
          amount: donationData.amount,
          currency: donationData.currency,
          payerEmail: donationData.payerEmail,
        },
      });

      strapi.log.info(
        `[BoldWebhook][CreatePending] ✓ Donación pendiente ACTUALIZADA: documentId=${record.documentId} | ${donationData.donorFullName}`
      );
      return { id: record.id.toString(), documentId: record.documentId };
    }

    const created = await strapi.documents(uid).create({
      data: {
        donorFullName: donationData.donorFullName,
        donorPhone: donationData.donorPhone,
        donorIdentification: donationData.donorIdentification,
        donorIdentificationType: donationData.donorIdentificationType,
        amount: donationData.amount,
        currency: donationData.currency,
        payerEmail: donationData.payerEmail,
        reference: donationData.reference,
        status: 'pending',
      },
    });

    strapi.log.info(
      `[BoldWebhook][CreatePending] ✓ Donación pendiente CREADA: documentId=${created.documentId} | ` +
      `${donationData.donorFullName} | $${donationData.amount} ${donationData.currency}`
    );
    return { id: created.id.toString(), documentId: created.documentId };
  },

  /**
   * Actualiza una donación existente con los datos del webhook de Bold.
   *
   * Busca por reference (orderId) para vincular con la donación pendiente
   * creada en el wizard. Si no encuentra por reference, busca por boldPaymentId.
   * Si no existe ninguna, crea una nueva (fallback para webhooks sin wizard).
   */
  async upsertDonation(
    donationData: DonationWebhookData
  ): Promise<{ created: boolean; id: string }> {
    const uid = 'api::donation.donation' as const;

    strapi.log.info(
      `[BoldWebhook][Upsert] ▶ Iniciando upsert | reference="${donationData.reference}" | ` +
      `boldPaymentId=${donationData.boldPaymentId} | eventType=${donationData.eventType} | ` +
      `status=${donationData.status}`
    );

    // 1. Buscar donación pendiente por reference (orderId del wizard)
    let existing: any[] = [];
    if (donationData.reference && donationData.reference.trim() !== '') {
      strapi.log.info(
        `[BoldWebhook][Upsert] Búsqueda 1: reference="${donationData.reference}" + status=pending`
      );
      existing = await strapi.documents(uid).findMany({
        filters: { reference: donationData.reference, status: 'pending' },
        limit: 1,
      });
      strapi.log.info(
        `[BoldWebhook][Upsert] Búsqueda 1 resultado: ${existing?.length ?? 0} registro(s)` +
        (existing?.length > 0 ? ` | documentId=${existing[0].documentId} status=${existing[0].status}` : '')
      );
    } else {
      strapi.log.warn('[BoldWebhook][Upsert] reference vacía — saltando búsqueda por reference');
    }

    // 2. Fallback: buscar por boldPaymentId (reintentos de Bold)
    if ((!existing || existing.length === 0) && donationData.boldPaymentId) {
      strapi.log.info(
        `[BoldWebhook][Upsert] Búsqueda 2 (fallback): boldPaymentId=${donationData.boldPaymentId}`
      );
      existing = await strapi.documents(uid).findMany({
        filters: { boldPaymentId: donationData.boldPaymentId },
        limit: 1,
      });
      strapi.log.info(
        `[BoldWebhook][Upsert] Búsqueda 2 resultado: ${existing?.length ?? 0} registro(s)` +
        (existing?.length > 0 ? ` | documentId=${existing[0].documentId} status=${existing[0].status}` : '')
      );
    }

    if (existing && existing.length > 0) {
      const record = existing[0];
      strapi.log.info(
        `[BoldWebhook][Upsert] Registro encontrado para actualizar: ` +
        `documentId=${record.documentId} | id=${record.id} | ` +
        `status actual="${record.status}" → nuevo status="${donationData.status}" | ` +
        `donorFullName=${record.donorFullName ?? 'N/A'}`
      );

      const updateData = {
        boldPaymentId: donationData.boldPaymentId,
        boldNotificationId: donationData.boldNotificationId,
        eventType: donationData.eventType,
        status: donationData.status,
        amount: donationData.amount,
        tip: donationData.tip,
        paymentMethod: donationData.paymentMethod,
        integration: donationData.integration,
        payerEmail: donationData.payerEmail,
        cardBrand: donationData.cardBrand,
        cardMaskedPan: donationData.cardMaskedPan,
        rawPayload: donationData.rawPayload,
      };

      strapi.log.info(`[BoldWebhook][Upsert] Data para update: ${JSON.stringify(updateData)}`);

      const updated = await strapi.documents(uid).update({
        documentId: record.documentId,
        data: updateData,
      });

      strapi.log.info(
        `[BoldWebhook][Upsert] ✓ Donación ACTUALIZADA exitosamente | ` +
        `documentId=${record.documentId} | id=${updated.id} | ` +
        `${donationData.boldPaymentId} → ${donationData.eventType} (${donationData.status})`
      );

      // Verificar que el update se persistió correctamente
      const verification = await strapi.documents(uid).findOne({
        documentId: record.documentId,
      });
      strapi.log.info(
        `[BoldWebhook][Upsert] Verificación post-update: status=${verification?.status} | ` +
        `boldPaymentId=${verification?.boldPaymentId} | eventType=${verification?.eventType}`
      );

      return { created: false, id: updated.id.toString() };
    }

    // 3. Fallback: crear nueva donación sin datos del wizard
    strapi.log.warn(
      `[BoldWebhook][Upsert] No se encontró donación existente — CREANDO NUEVA (sin wizard) | ` +
      `boldPaymentId=${donationData.boldPaymentId} | reference="${donationData.reference}"`
    );

    const created = await strapi.documents(uid).create({
      data: {
        boldPaymentId: donationData.boldPaymentId,
        boldNotificationId: donationData.boldNotificationId,
        eventType: donationData.eventType,
        amount: donationData.amount,
        currency: donationData.currency,
        tip: donationData.tip,
        status: donationData.status,
        paymentMethod: donationData.paymentMethod,
        integration: donationData.integration,
        payerEmail: donationData.payerEmail,
        cardBrand: donationData.cardBrand,
        cardMaskedPan: donationData.cardMaskedPan,
        reference: donationData.reference,
        rawPayload: donationData.rawPayload,
      },
    });

    strapi.log.info(
      `[BoldWebhook][Upsert] ✓ Nueva donación CREADA (sin wizard) | ` +
      `documentId=${created.documentId} | id=${created.id} | ` +
      `boldPaymentId=${donationData.boldPaymentId} | $${donationData.amount} ${donationData.currency}`
    );
    return { created: true, id: created.id.toString() };
  },
});
