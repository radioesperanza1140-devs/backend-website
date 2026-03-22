/**
 * Genera payloads de prueba para probar el flujo completo de donación via Postman.
 *
 * Flujo:
 *   1. POST /api/bold-webhook/get-signature  → Crea donación pendiente + genera firma
 *   2. POST /api/bold-webhook                → Simula webhook de Bold (actualiza donación)
 *
 * Uso: node scripts/generate-test-signature.js
 *
 * Requiere: archivo .env con BOLD_SECRET_KEY
 */
const crypto = require('crypto');
const path = require('path');

// Cargar .env
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const secretKey = process.env.BOLD_SECRET_KEY ?? '';
const orderId = 'ORDER-' + Date.now();
const amount = 100000;
const currency = 'COP';

// ═══════════════════════════════════════════════════════════════════
// PASO 1: get-signature (crea donación pendiente con datos del donante)
// ═══════════════════════════════════════════════════════════════════

const getSignaturePayload = {
  orderId,
  amount,
  currency,
  donorFullName: 'Juan Pérez García',
  donorPhone: '3001234567',
  donorIdentification: '1234567890',
  donorIdentificationType: 'CC',
  payerEmail: 'juan.perez@test.com',
};

console.log('══════════════════════════════════════════════════════');
console.log('  PASO 1: Crear donación pendiente + obtener firma');
console.log('══════════════════════════════════════════════════════\n');
console.log('URL:    POST http://localhost:1337/api/bold-webhook/get-signature');
console.log('Header: Content-Type: application/json');
console.log('Body (raw JSON):\n');
console.log(JSON.stringify(getSignaturePayload, null, 2));

// ═══════════════════════════════════════════════════════════════════
// PASO 2: Simular webhook de Bold (SALE_APPROVED)
// ═══════════════════════════════════════════════════════════════════

const webhookPayload = {
  id: 'test-' + crypto.randomUUID(),
  type: 'SALE_APPROVED',
  subject: 'TRX-TEST-' + Date.now(),
  source: 'https://test.bold.co',
  spec_version: '1.0',
  time: Math.floor(Date.now() / 1000),
  datacontenttype: 'application/json',
  data: {
    payment_id: 'PAY-TEST-' + Date.now(),
    merchant_id: 'test-merchant',
    created_at: new Date().toISOString(),
    amount: {
      total: amount,
      currency,
      taxes: 0,
      tip: 0,
    },
    payer_email: 'juan.perez@test.com',
    payment_method: 'CARD_WEB',
    metadata: {
      reference: orderId,  // ← Vincula con la donación pendiente del Paso 1
    },
  },
};

// IMPORTANTE: usar el mismo string exacto para firma y body
const bodyString = JSON.stringify(webhookPayload);
const bodyBase64 = Buffer.from(bodyString, 'utf-8').toString('base64');
const signature = crypto
  .createHmac('sha256', secretKey)
  .update(bodyBase64)
  .digest('hex');

console.log('\n══════════════════════════════════════════════════════');
console.log('  PASO 2: Simular webhook Bold (ejecutar DESPUÉS del Paso 1)');
console.log('══════════════════════════════════════════════════════\n');
console.log('URL:    POST http://localhost:1337/api/bold-webhook');
console.log('Headers:');
console.log('  Content-Type: application/json');
console.log('  x-bold-signature:', signature);
console.log('Body (copiar EXACTO, sin formatear):\n');
console.log(bodyString);
console.log('\n⚠️  IMPORTANTE: Pegar el body TAL CUAL (compacto, sin pretty-print).');
console.log('   Si Postman lo reformatea, la firma no coincidirá.');

console.log('\n══════════════════════════════════════════════════════');
console.log('  INFO');
console.log('══════════════════════════════════════════════════════');
console.log('Order ID compartido:', orderId);
console.log('BOLD_SECRET_KEY:', secretKey ? `${secretKey.substring(0, 6)}...` : '(vacía - modo sandbox)');
