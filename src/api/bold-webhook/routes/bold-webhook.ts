/**
 * bold-webhook router
 * POST /api/bold-webhook
 *
 * Recibe notificaciones de Bold sobre el estado de las transacciones.
 * Sin autenticación JWT de Strapi (Bold usa su propia firma HMAC).
 */
export default {
  routes: [
    {
      method: 'POST',
      path: '/bold-webhook/get-signature',
      handler: 'bold-webhook.getSignature',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/bold-webhook',
      handler: 'bold-webhook.handleBoldEvent',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
