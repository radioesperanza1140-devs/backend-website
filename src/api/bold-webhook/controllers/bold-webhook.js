'use strict';

const crypto = require('crypto');

module.exports = {
  async handleBoldEvent(ctx) {
    try {
      const body = ctx.request.body;
      const boldSignature = ctx.request.headers['x-bold-signature'];

      // 1. Validar que la petición viene de Bold
      const isValid = validateBoldSignature(body, boldSignature);
      if (!isValid) {
        strapi.log.warn('Webhook Bold: Firma inválida rechazada');
        return ctx.unauthorized('Firma inválida');
      }

      strapi.log.info(`Webhook Bold recibido: ${JSON.stringify(body)}`);

      // 2. Extraer datos del evento
      const {
        payment_status,
        amount,
        currency,
        order_id,
        customer_data,
      } = body;

      // 3. Verificar si ya existe esta donación (evitar duplicados)
      const existing = await strapi.entityService.findMany(
        'api::donation.donation',
        {
          filters: { boldOrderId: order_id },
        }
      );

      if (existing && existing.length > 0) {
        // Actualizar el estado si ya existe
        await strapi.entityService.update(
          'api::donation.donation',
          existing[0].id,
          {
            data: {
              status: mapBoldStatus(payment_status),
              rawPayload: body,
            },
          }
        );
        strapi.log.info(`Donación ${order_id} actualizada: ${payment_status}`);
      } else {
        // Crear nueva donación
        await strapi.entityService.create('api::donation.donation', {
          data: {
            boldOrderId: order_id,
            amount: amount?.total_amount
              ? amount.total_amount / 100 // Bold puede enviar en centavos
              : 0,
            currency: currency || 'COP',
            status: mapBoldStatus(payment_status),
            donorEmail: customer_data?.email || '',
            donorName: customer_data?.full_name || 'Anónimo',
            rawPayload: body,
          },
        });
        strapi.log.info(`Nueva donación registrada: ${order_id}`);
      }

      // 4. Responder 200 OK a Bold
      ctx.send({ received: true });
    } catch (error) {
      strapi.log.error('Error procesando webhook Bold:', error);
      ctx.internalServerError('Error interno');
    }
  },
};

/**
 * Valida la firma HMAC-SHA256 de Bold
 * Docs: Convertir body a Base64, cifrar con HMAC-SHA256 usando llave de identidad
 */
function validateBoldSignature(body, receivedSignature) {
  if (!receivedSignature) return false;

  const BOLD_IDENTITY_KEY = process.env.BOLD_IDENTITY_KEY;
  if (!BOLD_IDENTITY_KEY) {
    strapi.log.error('BOLD_IDENTITY_KEY no configurada en .env');
    return false;
  }

  try {
    // Paso 1: Convertir el body a Base64
    const bodyString = JSON.stringify(body);
    const bodyBase64 = Buffer.from(bodyString).toString('base64');

    // Paso 2: Generar HMAC-SHA256 con la llave de identidad
    const computedSignature = crypto
      .createHmac('sha256', BOLD_IDENTITY_KEY)
      .update(bodyBase64)
      .digest('hex');

    // Paso 3: Comparar con timing-safe para evitar timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex')
    );
  } catch (error) {
    strapi.log.error('Error validando firma Bold:', error);
    return false;
  }
}

/**
 * Mapea estados de Bold a tu enumeración
 */
function mapBoldStatus(boldStatus) {
  const statusMap = {
    approved: 'approved',
    pending: 'pending',
    rejected: 'rejected',
    failed: 'rejected',
    voided: 'rejected',
  };
  return statusMap[boldStatus] || 'pending';
}