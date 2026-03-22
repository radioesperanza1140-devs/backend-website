/**
 * Mapeo de eventos Bold (CloudEvents) a datos internos de donacion.
 */
import type {
  BoldWebhookEvent,
  BoldEventType,
  DonationStatus,
  DonationWebhookData,
} from '../types/bold-webhook';

const EVENT_STATUS_MAP: Record<BoldEventType, DonationStatus> = {
  SALE_APPROVED: 'approved',
  SALE_REJECTED: 'rejected',
  VOID_APPROVED: 'voided',
  VOID_REJECTED: 'approved', // Anulacion rechazada = venta sigue aprobada
};

/**
 * Extrae y mapea los datos del evento Bold a la estructura interna de Donation.
 * `amount.total` de Bold viene en unidades (NO centavos). Ej: 59900 = $59.900 COP
 */
export function mapEventToDonation(event: BoldWebhookEvent): DonationWebhookData {
  const { data } = event;

  return {
    boldPaymentId: data.payment_id,
    boldNotificationId: event.id,
    eventType: event.type,
    amount: data.amount.total,
    currency: data.amount.currency ?? 'COP',
    tip: data.amount.tip ?? 0,
    boldStatus: EVENT_STATUS_MAP[event.type] ?? 'pending',
    paymentMethod: data.payment_method ?? 'unknown',
    integration: data.integration ?? 'BUTTON',
    payerEmail: data.payer_email ?? '',
    cardBrand: data.card?.brand ?? '',
    cardMaskedPan: data.card?.masked_pan ?? '',
    reference: data.metadata?.reference ?? '',
    rawPayload: JSON.stringify(event),
  };
}
