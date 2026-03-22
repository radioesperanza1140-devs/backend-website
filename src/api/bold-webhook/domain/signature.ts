/**
 * Validacion de firma HMAC-SHA256 para webhooks de Bold.
 *
 * Proceso segun documentacion oficial (https://developers.bold.co/webhook):
 * 1. Codificar el body en Base64
 * 2. Generar HMAC-SHA256 con la llave secreta
 * 3. Convertir a hexadecimal y comparar con x-bold-signature
 */
import crypto from 'crypto';

/**
 * Genera la firma HMAC-SHA256 esperada para un body dado.
 */
export function computeSignature(rawBody: Buffer | string, secretKey: string): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf-8');
  const encoded = body.toString('base64');

  return crypto
    .createHmac('sha256', secretKey)
    .update(encoded)
    .digest('hex');
}

/**
 * Valida que la firma recibida coincida con la esperada.
 * Usa timingSafeEqual para prevenir ataques de timing.
 */
export function verifySignature(
  rawBody: Buffer | string,
  receivedSignature: string | undefined,
  secretKey: string,
): boolean {
  if (!receivedSignature) {
    strapi.log.warn('[Signature] No se recibio x-bold-signature');
    return false;
  }

  try {
    const expected = computeSignature(rawBody, secretKey);
    const bodyLen = Buffer.isBuffer(rawBody) ? rawBody.length : rawBody.length;
    strapi.log.debug(
      `[Signature] Verificando | bodyBytes=${bodyLen} | ` +
      `expectedPrefix=${expected.substring(0, 16)}... | ` +
      `receivedPrefix=${receivedSignature.substring(0, 16)}...`
    );
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(receivedSignature),
    );
    strapi.log.info(`[Signature] Resultado verificacion: ${isValid ? 'VALIDA' : 'INVALIDA'}`);
    return isValid;
  } catch (error) {
    strapi.log.error(`[Signature] Error en verificacion: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Genera el hash SHA-256 de integridad para Bold Checkout (client-side).
 */
export function computeIntegrityHash(
  orderId: string,
  amount: number,
  currency: string,
  secretKey: string,
): string {
  const data = `${orderId}${amount}${currency}${secretKey}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}
