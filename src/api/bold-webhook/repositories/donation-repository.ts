/**
 * Repositorio de donaciones.
 * Aísla todas las operaciones de base de datos relacionadas con la coleccion Donation.
 */
import type { DonationPendingData, DonationWebhookData } from '../types/bold-webhook';

const DONATION_UID = 'api::donation.donation' as const;

/**
 * Busca una donacion pendiente por reference (orderId).
 */
export async function findPendingByReference(reference: string) {
  if (!reference || reference.trim() === '') {
    strapi.log.debug('[DonationRepo] findPendingByReference: reference vacio, retornando null');
    return null;
  }

  const results = await strapi.documents(DONATION_UID).findMany({
    filters: { reference, status: 'pending' },
    limit: 1,
  });

  const found = results?.length > 0 ? results[0] : null;
  strapi.log.info(
    `[DonationRepo] findPendingByReference | reference=${reference} | encontrado=${!!found}` +
    (found ? ` | documentId=${found.documentId}` : '')
  );
  return found;
}

/**
 * Busca una donacion por boldPaymentId (para reintentos de Bold).
 */
export async function findByPaymentId(boldPaymentId: string) {
  if (!boldPaymentId) {
    strapi.log.debug('[DonationRepo] findByPaymentId: boldPaymentId vacio, retornando null');
    return null;
  }

  const results = await strapi.documents(DONATION_UID).findMany({
    filters: { boldPaymentId },
    limit: 1,
  });

  const found = results?.length > 0 ? results[0] : null;
  strapi.log.info(
    `[DonationRepo] findByPaymentId | boldPaymentId=${boldPaymentId} | encontrado=${!!found}` +
    (found ? ` | documentId=${found.documentId}` : '')
  );
  return found;
}

/**
 * Crea una donacion pendiente con los datos del wizard.
 */
export async function createPending(data: DonationPendingData) {
  strapi.log.info(
    `[DonationRepo] Creando donacion pendiente | ` +
    `reference=${data.reference} | amount=${data.amount} ${data.currency} | ` +
    `donor=${data.donorFullName}`
  );
  const result = await strapi.documents(DONATION_UID).create({
    data: {
      donorFullName: data.donorFullName,
      donorPhone: data.donorPhone,
      donorIdentification: data.donorIdentification,
      donorIdentificationType: data.donorIdentificationType,
      amount: data.amount,
      currency: data.currency,
      payerEmail: data.payerEmail,
      reference: data.reference,
      status: 'pending',
    },
  });
  strapi.log.info(`[DonationRepo] Donacion pendiente creada | documentId=${result.documentId}`);
  return result;
}

/**
 * Actualiza una donacion pendiente existente con datos del wizard.
 */
export async function updatePendingDonor(documentId: string, data: DonationPendingData) {
  strapi.log.info(
    `[DonationRepo] Actualizando donacion pendiente | ` +
    `documentId=${documentId} | reference=${data.reference} | ` +
    `amount=${data.amount} ${data.currency}`
  );
  return strapi.documents(DONATION_UID).update({
    documentId,
    data: {
      donorFullName: data.donorFullName,
      donorPhone: data.donorPhone,
      donorIdentification: data.donorIdentification,
      donorIdentificationType: data.donorIdentificationType,
      amount: data.amount,
      currency: data.currency,
      payerEmail: data.payerEmail,
    },
  });
}

/**
 * Actualiza una donacion existente con los datos del webhook de Bold.
 */
export async function updateFromWebhook(documentId: string, data: DonationWebhookData) {
  strapi.log.info(
    `[DonationRepo] Actualizando desde webhook | ` +
    `documentId=${documentId} | paymentId=${data.boldPaymentId} | ` +
    `event=${data.eventType} -> status=${data.status} | ` +
    `amount=${data.amount} ${data.currency}`
  );
  return strapi.documents(DONATION_UID).update({
    documentId,
    data: {
      boldPaymentId: data.boldPaymentId,
      boldNotificationId: data.boldNotificationId,
      eventType: data.eventType,
      status: data.status,
      amount: data.amount,
      tip: data.tip,
      paymentMethod: data.paymentMethod,
      integration: data.integration,
      payerEmail: data.payerEmail,
      cardBrand: data.cardBrand,
      cardMaskedPan: data.cardMaskedPan,
      rawPayload: data.rawPayload,
    },
  });
}

/**
 * Crea una nueva donacion directamente desde el webhook (sin wizard previo).
 */
export async function createFromWebhook(data: DonationWebhookData) {
  strapi.log.info(
    `[DonationRepo] Creando donacion desde webhook (sin wizard previo) | ` +
    `paymentId=${data.boldPaymentId} | event=${data.eventType} | ` +
    `amount=${data.amount} ${data.currency} | reference=${data.reference}`
  );
  return strapi.documents(DONATION_UID).create({
    data: {
      boldPaymentId: data.boldPaymentId,
      boldNotificationId: data.boldNotificationId,
      eventType: data.eventType,
      amount: data.amount,
      currency: data.currency,
      tip: data.tip,
      status: data.status,
      paymentMethod: data.paymentMethod,
      integration: data.integration,
      payerEmail: data.payerEmail,
      cardBrand: data.cardBrand,
      cardMaskedPan: data.cardMaskedPan,
      reference: data.reference,
      rawPayload: data.rawPayload,
    },
  });
}
