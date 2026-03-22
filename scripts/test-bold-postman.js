/**
 * Genera una colección Postman (v2.1) lista para importar con el flujo completo de donación.
 *
 * Uso: node scripts/test-bold-postman.js > bold-test-collection.json
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

// --- Postman Collection ---
// IMPORTANTE: el body del webhook debe ser el string compacto exacto sobre el cual se calculó la firma.
// Si Postman reformatea el JSON (pretty-print), los bytes cambian y la firma no coincide.

const collection = {
  info: {
    name: `Bold Webhook Test (${orderId})`,
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description: 'Flujo completo: crear donación pendiente → simular webhook Bold.\nIMPORTANTE: No reformatear el body del Paso 2, debe ser el JSON compacto exacto.',
  },
  item: [
    {
      name: 'Paso 1 - Crear donación pendiente (get-signature)',
      request: {
        method: 'POST',
        header: [
          { key: 'Content-Type', value: 'application/json' },
        ],
        body: {
          mode: 'raw',
          raw: JSON.stringify(getSignaturePayload, null, 2),
          options: { raw: { language: 'json' } },
        },
        url: { raw: `${BASE_URL}/api/bold-webhook/get-signature` },
      },
    },
    {
      name: 'Paso 2 - Simular webhook Bold (SALE_APPROVED) - NO reformatear body',
      request: {
        method: 'POST',
        header: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'x-bold-signature', value: signature },
        ],
        body: {
          mode: 'raw',
          raw: bodyString,
          options: { raw: { language: 'text' } },
        },
        url: { raw: `${BASE_URL}/api/bold-webhook` },
      },
    },
  ],
};

console.log(JSON.stringify(collection, null, 2));

// Info a stderr para que no contamine el JSON si se redirige
console.error('\n══════════════════════════════════════════════════════');
console.error('  Colección Postman generada');
console.error('══════════════════════════════════════════════════════');
console.error('Order ID:', orderId);
console.error('Firma x-bold-signature:', signature);
console.error('BOLD_SECRET_KEY:', secretKey ? `${secretKey.substring(0, 6)}...` : '(vacía - modo sandbox)');
console.error('\nPara importar: node scripts/test-bold-postman.js > bold-test-collection.json');
console.error('Luego en Postman: Import → Upload Files → bold-test-collection.json');
