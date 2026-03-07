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
  DonationCreateData,
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
  validateSignature(rawBody: string, receivedSignature: string | undefined): boolean {
    if (!receivedSignature) {
      strapi.log.warn('[BoldWebhook] No se recibió header x-bold-signature');
      return false;
    }
    
    // En producción usa BOLD_SECRET_KEY; en pruebas puede estar vacía
    const secretKey = process.env.BOLD_SECRET_KEY ?? '';

    try {
      // Paso 1: Body string → Base64
      const bodyBase64 = Buffer.from(rawBody, 'utf-8').toString('base64');

      // Paso 2: HMAC-SHA256(base64Body, secretKey) → hex
      const computedSignature = crypto
        .createHmac('sha256', secretKey)
        .update(bodyBase64)
        .digest('hex');

      // Paso 3: Comparación timing-safe
      const sigBuffer = Buffer.from(computedSignature, 'hex');
      const receivedBuffer = Buffer.from(receivedSignature, 'hex');

      if (sigBuffer.length !== receivedBuffer.length) {
        strapi.log.warn('[BoldWebhook] Longitud de firma no coincide');
        return false;
      }
      console.log(crypto.timingSafeEqual(sigBuffer, receivedBuffer));
      return crypto.timingSafeEqual(sigBuffer, receivedBuffer);
    } catch (error) {
      strapi.log.error('[BoldWebhook] Error validando firma:', error);
      return false;
    }
  },

  /**
   * Valida que el payload tenga la estructura mínima esperada de Bold (CloudEvents).
   */
  validatePayload(body: unknown): body is BoldWebhookEvent {
    if (!body || typeof body !== 'object') return false;

    const event = body as Record<string, unknown>;

    // Campos raíz obligatorios del CloudEvent
    if (!event.id || !event.type || !event.subject || !event.data) {
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
      return false;
    }

    // Validar campos mínimos dentro de data
    const data = event.data as Record<string, unknown>;
    if (!data.payment_id || !data.amount) {
      return false;
    }

    return true;
  },

  /**
   * Extrae y mapea los datos del evento Bold a la estructura de Donation.
   *
   * Nota: `amount.total` de Bold ya viene en unidades (NO centavos).
   * Ejemplo: 59900 = $59.900 COP
   */
  extractDonationData(event: BoldWebhookEvent): DonationCreateData {
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
   * Crea o actualiza una donación en la base de datos.
   *
   * - Si ya existe un registro con el mismo boldPaymentId, lo actualiza
   *   (Bold puede enviar múltiples eventos para la misma transacción,
   *    ej: primero SALE_APPROVED, luego VOID_APPROVED).
   * - Si no existe, crea uno nuevo.
   */
  async upsertDonation(
    donationData: DonationCreateData
  ): Promise<{ created: boolean; id: string }> {
    const uid = 'api::donation.donation' as const;

    // Buscar donación existente por boldPaymentId
    const existing = await strapi.documents(uid).findMany({
      filters: { boldPaymentId: donationData.boldPaymentId },
      limit: 1,
    });

    if (existing && existing.length > 0) {
      const record = existing[0];

      const updated = await strapi.documents(uid).update({
        documentId: record.documentId,
        data: {
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
          reference: donationData.reference,
          rawPayload: donationData.rawPayload,
        },
      });

      strapi.log.info(
        `[BoldWebhook] Donación actualizada: ${donationData.boldPaymentId} → ${donationData.eventType}`
      );
      return { created: false, id: updated.id.toString() };
    }

    // Crear nueva donación
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
      `[BoldWebhook] Nueva donación: ${donationData.boldPaymentId} | ` +
      `$${donationData.amount} ${donationData.currency} | ${donationData.paymentMethod}`
    );
    return { created: true, id: created.id.toString()  };
  },
});
