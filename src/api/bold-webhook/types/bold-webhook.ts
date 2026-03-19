/**
 * Tipos del webhook de Bold basados en la documentación oficial:
 * https://developers.bold.co/webhook
 *
 * Bold usa la especificación CloudEvents para sus notificaciones.
 */

// ─── Eventos ────────────────────────────────────────────────────────────────

/** Tipos de evento que Bold puede notificar */
export type BoldEventType =
  | 'SALE_APPROVED'    // Venta aprobada
  | 'SALE_REJECTED'    // Venta rechazada
  | 'VOID_APPROVED'    // Anulación aprobada
  | 'VOID_REJECTED';   // Anulación rechazada

// ─── Métodos de pago ────────────────────────────────────────────────────────

export type BoldPaymentMethod =
  | 'CARD'                // Tarjeta crédito/débito (datáfono)
  | 'SOFT_POS'            // Tarjeta usando dispositivo móvil
  | 'CARD_WEB'            // Tarjeta crédito/débito (link/botón de pagos)
  | 'NEQUI'               // Nequi
  | 'BOTON_BANCOLOMBIA'   // Botón Bancolombia
  | 'PSE'                 // PSE
  | 'QR';                 // QR Bold

// ─── Tipos de integración ───────────────────────────────────────────────────

export type BoldIntegration =
  | 'POS'               // Datáfono Bold Plus
  | 'SOFT_POS'          // Datáfono móvil
  | 'API_INTEGRATIONS'  // API Integrations
  | 'APP_LINK'          // AppLink (deeplink)
  | 'BUTTON'            // Botón de pagos
  | 'LINK';             // Link de pagos

// ─── Franquicias de tarjeta ─────────────────────────────────────────────────

export type CardBrand =
  | 'VISA'
  | 'VISA_ELECTRON'
  | 'MASTERCARD'
  | 'MAESTRO'
  | 'AMERICAN_EXPRESS'
  | 'CODENSA'
  | 'DINERS'
  | 'DISCOVER'
  | 'TUYA'
  | 'SODEXO'
  | 'OLIMPICA'
  | 'UNKOWN';

// ─── Impuestos ──────────────────────────────────────────────────────────────

export type TaxType = 'VAT' | 'CONSUMPTION';

export interface BoldTax {
  base: number;
  type: TaxType;
  value: number;
}

// ─── Monto ──────────────────────────────────────────────────────────────────

export interface BoldAmount {
  currency: string;   // ISO 4217: "COP", "USD"
  total: number;      // Total en unidades (NO centavos). Ej: 59900 = $59.900 COP
  taxes: BoldTax[];
  tip: number;
}

// ─── Tarjeta (opcional, solo cuando payment_method es CARD/CARD_WEB/SOFT_POS)

export interface BoldCard {
  capture_mode?: string;         // "CHIP" | "CONTACTLESS_CHIP" (solo datáfono)
  brand: CardBrand;
  cardholder_name: string;
  terminal_id?: string;
  masked_pan: string;            // "451732******0019"
  installments: number;
  card_type: 'DEBIT' | 'CREDIT';
}

// ─── Metadata ───────────────────────────────────────────────────────────────

export interface BoldMetadata {
  reference: string | null;   // order-id del botón de pagos, o null
}

// ─── Data (cuerpo de la notificación) ───────────────────────────────────────

export interface BoldEventData {
  payment_id: string;
  merchant_id: string;
  created_at: string;            // ISO 8601: "2025-10-21T12:30:10-05:00"
  amount: BoldAmount;
  user_id: string;
  metadata: BoldMetadata;
  bold_code: string;
  payer_email: string;
  payment_method: BoldPaymentMethod;
  card?: BoldCard;               // Solo en pagos con tarjeta
  approval_number?: string;      // Solo en pagos con tarjeta
  integration?: BoldIntegration;
}

// ─── Evento CloudEvents (raíz del webhook) ──────────────────────────────────

export interface BoldWebhookEvent {
  id: string;                    // UUID de la notificación (único por envío)
  type: BoldEventType;
  subject: string;               // ID de la transacción (= payment_id)
  source: string;                // Recurso que lanzó la notificación
  spec_version: string;          // "1.0"
  time: number;                  // POSIX timestamp en nanosegundos
  data: BoldEventData;
  datacontenttype?: string;      // "application/json"
}

// ─── Tipos de identificación del donante ─────────────────────────────────────

export type DonorIdentificationType = 'CC' | 'CE' | 'NIT' | 'PP' | 'TI';

// ─── Tipos para la colección Donation en Strapi ─────────────────────────────

export type DonationStatus = 'approved' | 'pending' | 'rejected' | 'voided';

/** Datos del donante capturados en el wizard antes de pagar */
export interface DonorInfo {
  donorFullName: string;
  donorPhone: string;
  donorIdentification: string;
  donorIdentificationType: DonorIdentificationType;
}

/** Datos para crear la donación pendiente (wizard + get-signature) */
export interface DonationPendingData extends DonorInfo {
  amount: number;
  currency: string;
  reference: string;
  payerEmail: string;
  status: DonationStatus;
}

/** Datos del webhook de Bold para actualizar la donación */
export interface DonationWebhookData {
  boldPaymentId: string;
  boldNotificationId: string;
  eventType: BoldEventType;
  amount: number;
  currency: string;
  tip: number;
  status: DonationStatus;
  paymentMethod: string;
  integration: string;
  payerEmail: string;
  cardBrand: string;
  cardMaskedPan: string;
  reference: string;
  rawPayload: string;
}
