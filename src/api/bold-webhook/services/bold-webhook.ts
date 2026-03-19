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
      strapi.log.warn('[BoldWebhook] No se recibió header x-bold-signature');
      return false;
    }

    // En producción usa BOLD_SECRET_KEY; en pruebas la llave es un string vacío
    const secretKey = process.env.BOLD_SECRET_KEY ?? '';

    try {
      // Paso 1: Convertir el cuerpo recibido a formato Base64
      // (Igual que: const encoded = base64.encode(body) en el ejemplo de Bold)
      const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf-8');
      const encoded = body.toString('base64');

      // Paso 2: Cifrar con HMAC-SHA256 usando la llave secreta → hexadecimal
      const hashed = crypto
        .createHmac('sha256', secretKey)
        .update(encoded)
        .digest('hex');

      // Paso 3: Comparar con el valor del encabezado x-bold-signature
      // (Igual que el ejemplo de Bold: crypto.timingSafeEqual(Buffer.from(hashed), Buffer.from(receivedSignature)))
      const isValid = crypto.timingSafeEqual(
        Buffer.from(hashed),
        Buffer.from(receivedSignature)
      );

      return isValid;
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

    // Buscar donación pendiente existente con el mismo orderId para evitar duplicados
    const existing = await strapi.documents(uid).findMany({
      filters: { reference: donationData.reference, status: 'pending' },
      limit: 1,
    });

    if (existing && existing.length > 0) {
      const record = existing[0];
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
        `[BoldWebhook] Donación pendiente actualizada: ${record.documentId} | ${donationData.donorFullName}`
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
      `[BoldWebhook] Donación pendiente creada: ${created.documentId} | ` +
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

    // 1. Buscar donación pendiente por reference (orderId del wizard)
    // Solo buscar si reference no está vacío para evitar matchear registros incorrectos
    let existing: any[] = [];
    if (donationData.reference && donationData.reference.trim() !== '') {
      existing = await strapi.documents(uid).findMany({
        filters: { reference: donationData.reference, status: 'pending' },
        limit: 1,
      });
    }

    // 2. Fallback: buscar por boldPaymentId (reintentos de Bold)
    if ((!existing || existing.length === 0) && donationData.boldPaymentId) {
      existing = await strapi.documents(uid).findMany({
        filters: { boldPaymentId: donationData.boldPaymentId },
        limit: 1,
      });
    }

    if (existing && existing.length > 0) {
      const record = existing[0];

      const updated = await strapi.documents(uid).update({
        documentId: record.documentId,
        data: {
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
        },
      });

      strapi.log.info(
        `[BoldWebhook] Donación actualizada: ${donationData.boldPaymentId} → ${donationData.eventType}`
      );
      return { created: false, id: updated.id.toString() };
    }

    // 3. Fallback: crear nueva donación sin datos del wizard (campos del donante quedan null)
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
      `[BoldWebhook] Nueva donación (sin wizard): ${donationData.boldPaymentId} | ` +
      `$${donationData.amount} ${donationData.currency}`
    );
    return { created: true, id: created.id.toString() };
  },
});
