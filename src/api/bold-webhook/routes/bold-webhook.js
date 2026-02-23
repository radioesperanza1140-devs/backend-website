'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/bold-webhook',
      handler: 'bold-webhook.handleBoldEvent',
      config: {
        auth: false, // Bold no envía token JWT de Strapi
        policies: [],
        middlewares: [],
      },
    },
  ],
};