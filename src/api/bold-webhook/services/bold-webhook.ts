/**
 * bold-webhook service
 *
 * Orquesta la logica de negocio del webhook de Bold:
 * - Validacion de firma HMAC-SHA256
 * - Validacion de payload CloudEvents
 * - Mapeo de eventos a datos de donacion
 * - Persistencia via repositorio
 *
 * Ref: https://developers.bold.co/webhook
 */
import { verifySignature, computeIntegrityHash } from '../domain/signature';
import { isValidBoldEvent, validateSignatureRequest } from '../domain/validators';
import { mapEventToDonation } from '../domain/event-mapper';
import * as donationRepo from '../repositories/donation-repository';
import type { BoldWebhookEvent, DonationPendingData } from '../types/bold-webhook';

export default () => ({
  /**
   * Valida la firma HMAC-SHA256 del webhook de Bold.
   */
  validateSignature(rawBody: Buffer | string, receivedSignature: string | undefined): boolean {
    const secretKey = process.env.BOLD_SECRET_KEY ?? '';
    return verifySignature(rawBody, receivedSignature, secretKey);
  },

  /**
   * Valida la estructura del payload CloudEvents de Bold.
   */
  validatePayload(body: unknown): body is BoldWebhookEvent {
    return isValidBoldEvent(body);
  },

  /**
   * Extrae datos de donacion del evento Bold.
   */
  extractDonationData(event: BoldWebhookEvent) {
    return mapEventToDonation(event);
  },

  /**
   * Valida y genera la firma de integridad para Bold Checkout.
   */
  validateAndComputeIntegrity(body: unknown) {
    if (!validateSignatureRequest(body)) return null;

    const secretKey = process.env.BOLD_SECRET_KEY;
    if (!secretKey) return null;

    const { orderId, amount, currency } = body;
    const amountNum = Math.round(Number(amount));
    const curr = currency ?? 'COP';
    const hash = computeIntegrityHash(orderId, amountNum, curr, secretKey);

    return { integritySignature: hash, orderId, amount: amountNum, currency: curr };
  },

  /**
   * Crea o actualiza una donacion pendiente con datos del wizard.
   */
  async createPendingDonation(data: DonationPendingData): Promise<{ id: string; documentId: string }> {
    const existing = await donationRepo.findPendingByReference(data.reference);

    if (existing) {
      await donationRepo.updatePendingDonor(existing.documentId, data);
      strapi.log.info(`[BoldWebhook] Donacion pendiente actualizada: ${existing.documentId}`);
      return { id: existing.id.toString(), documentId: existing.documentId };
    }

    const created = await donationRepo.createPending(data);
    strapi.log.info(`[BoldWebhook] Donacion pendiente creada: ${created.documentId}`);
    return { id: created.id.toString(), documentId: created.documentId };
  },

  /**
   * Upsert de donacion desde el webhook de Bold.
   *
   * Estrategia de busqueda:
   * 1. Por reference (orderId del wizard) + status pending
   * 2. Fallback: por boldPaymentId (reintentos de Bold)
   * 3. Crear nueva si no existe (webhook sin wizard previo)
   */
  async upsertDonation(donationData: ReturnType<typeof mapEventToDonation>): Promise<{ created: boolean; id: string }> {
    // 1. Buscar por reference
    let record = await donationRepo.findPendingByReference(donationData.reference);

    // 2. Fallback: buscar por boldPaymentId
    if (!record) {
      record = await donationRepo.findByPaymentId(donationData.boldPaymentId);
    }

    // 3. Actualizar o crear
    if (record) {
      const updated = await donationRepo.updateFromWebhook(record.documentId, donationData);
      strapi.log.info(
        `[BoldWebhook] Donacion actualizada: ${record.documentId} | ` +
        `${donationData.eventType} -> ${donationData.boldStatus}`
      );
      return { created: false, id: updated.id.toString() };
    }

    const created = await donationRepo.createFromWebhook(donationData);
    strapi.log.warn(
      `[BoldWebhook] Donacion creada sin wizard: ${created.documentId} | ` +
      `${donationData.boldPaymentId}`
    );
    return { created: true, id: created.id.toString() };
  },
});
