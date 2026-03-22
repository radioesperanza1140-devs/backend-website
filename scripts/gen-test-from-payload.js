/**
 * Genera curls de prueba a partir del payload Bold proporcionado.
 * Uso: node scripts/gen-test-from-payload.js
 */
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const webhookPayload = {"id":"c1d4e7f0-a3b8-4c9d-8e7f-1a2b3c4d5e6f","type":"SALE_APPROVED","subject":"TLCP9YXRV23","source":"/payments/nequi","spec_version":"1.0","time":1761065000000000000,"data":{"payment_id":"TLCP9YXRV23","merchant_id":"MCNT2025XYZ","created_at":"2025-10-21T12:40:00-05:00","amount":{"currency":"COP","total":125000,"taxes":[{"base":100000,"type":"VAT","value":19000}],"tip":6000},"user_id":"nequi_user_9876543210","metadata":{"reference":"APP-VENTA-45210"},"bold_code":"B000","payer_email":"pagador.nequi@example.com","payment_method":"NEQUI"},"datacontenttype":"application/json"};

const secretKey = process.env.BOLD_SECRET_KEY || '';
const reference = webhookPayload.data.metadata.reference;
const amount = webhookPayload.data.amount.total;
const currency = webhookPayload.data.amount.currency;
const payerEmail = webhookPayload.data.payer_email;

// Paso 1: get-signature payload
const getSignaturePayload = {
  orderId: reference,
  amount,
  currency,
  donorFullName: 'Pagador Nequi Test',
  donorPhone: '3009876543',
  donorIdentification: '9876543210',
  donorIdentificationType: 'CC',
  payerEmail,
};

// Paso 2: firma HMAC
const bodyString = JSON.stringify(webhookPayload);
const bodyBase64 = Buffer.from(bodyString, 'utf-8').toString('base64');
const signature = crypto
  .createHmac('sha256', secretKey)
  .update(bodyBase64)
  .digest('hex');

console.log('══════════════════════════════════════════════════════');
console.log('  PASO 1: Crear donacion pendiente (get-signature)');
console.log('══════════════════════════════════════════════════════\n');

console.log(
  'curl -X POST http://localhost:1337/api/bold-webhook/get-signature \\\n' +
  '  -H "Content-Type: application/json" \\\n' +
  "  -d '" + JSON.stringify(getSignaturePayload) + "'"
);

console.log('\n══════════════════════════════════════════════════════');
console.log('  PASO 2: Simular webhook Bold (SALE_APPROVED)');
console.log('══════════════════════════════════════════════════════\n');

console.log(
  'curl -X POST http://localhost:1337/api/bold-webhook \\\n' +
  '  -H "Content-Type: application/json" \\\n' +
  '  -H "x-bold-signature: ' + signature + '" \\\n' +
  "  -d '" + bodyString + "'"
);

console.log('\n══════════════════════════════════════════════════════');
console.log('  INFO');
console.log('══════════════════════════════════════════════════════');
console.log('Reference/OrderId:', reference);
console.log('Amount:', amount, currency);
console.log('BOLD_SECRET_KEY:', secretKey ? secretKey.substring(0, 6) + '...' : '(vacia)');
console.log('x-bold-signature:', signature);
