/**
 * Genera comandos curl listos para probar el flujo completo de donación.
 *
 * Uso: node scripts/test-bold-curl.js
 * Requiere: archivo .env con BOLD_SECRET_KEY
 */
const crypto = require('crypto');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:1337';
const secretKey = process.env.BOLD_SECRET_KEY ?? '';
const orderId = 'ORDER-' + Date.now();
const amount = 100000;
const currency = 'COP';

// --- Paso 1: get-signature ---

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

// --- Paso 2: webhook ---

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
    amount: { total: amount, currency, taxes: 0, tip: 0 },
    payer_email: 'juan.perez@test.com',
    payment_method: 'CARD_WEB',
    metadata: { reference: orderId },
  },
};

const bodyString = JSON.stringify(webhookPayload);
const bodyBase64 = Buffer.from(bodyString, 'utf-8').toString('base64');
const signature = crypto
  .createHmac('sha256', secretKey)
  .update(bodyBase64)
  .digest('hex');

// --- Output ---

console.log('══════════════════════════════════════════════════════');
console.log('  PASO 1: Crear donación pendiente + obtener firma');
console.log('══════════════════════════════════════════════════════\n');

console.log(`curl -X POST ${BASE_URL}/api/bold-webhook/get-signature \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(getSignaturePayload)}'`);

console.log('\n══════════════════════════════════════════════════════');
console.log('  PASO 2: Simular webhook Bold (ejecutar DESPUÉS del Paso 1)');
console.log('══════════════════════════════════════════════════════\n');

console.log(`curl -X POST ${BASE_URL}/api/bold-webhook \\
  -H "Content-Type: application/json" \\
  -H "x-bold-signature: ${signature}" \\
  -d '${bodyString}'`);

console.log('\n══════════════════════════════════════════════════════');
console.log('  INFO');
console.log('══════════════════════════════════════════════════════');
console.log('Order ID:', orderId);
console.log('BOLD_SECRET_KEY:', secretKey ? `${secretKey.substring(0, 6)}...` : '(vacía - modo sandbox)');
