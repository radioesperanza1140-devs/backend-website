/**
 * Validacion de payloads del webhook de Bold (CloudEvents v1.0).
 */
import type { BoldWebhookEvent, BoldEventType } from '../types/bold-webhook';

const VALID_EVENT_TYPES: BoldEventType[] = [
  'SALE_APPROVED',
  'SALE_REJECTED',
  'VOID_APPROVED',
  'VOID_REJECTED',
];

/**
 * Valida que el body tenga la estructura minima esperada de un CloudEvent de Bold.
 */
export function isValidBoldEvent(body: unknown): body is BoldWebhookEvent {
  if (!body || typeof body !== 'object') return false;

  const event = body as Record<string, unknown>;

  if (!event.id || !event.type || !event.subject || !event.data) return false;
  if (!VALID_EVENT_TYPES.includes(event.type as BoldEventType)) return false;

  const data = event.data as Record<string, unknown>;
  if (!data.payment_id || !data.amount) return false;

  return true;
}

/**
 * Valida los campos requeridos para generar la firma de integridad.
 */
export interface SignatureRequestBody {
  orderId: string;
  amount: number;
  currency: string;
  donorFullName: string;
  donorPhone?: string;
  donorIdentification: string;
  donorIdentificationType: string;
  payerEmail?: string;
}

export function validateSignatureRequest(body: unknown): body is SignatureRequestBody {
  if (!body || typeof body !== 'object') return false;

  const b = body as Record<string, unknown>;

  if (!b.orderId || typeof b.orderId !== 'string' || b.orderId.trim() === '') return false;

  const amount = Number(b.amount);
  if (!b.amount || isNaN(amount) || amount <= 0) return false;

  if (!b.donorFullName || !b.donorIdentification || !b.donorIdentificationType) return false;

  return true;
}
