/**
 * Middleware that captures the raw request body before Koa's JSON parser
 * processes it. This is required for Bold webhook signature validation,
 * which needs the exact bytes Bold sent.
 *
 * Add to: src/middlewares/raw-body.ts
 * Register in: config/middlewares.ts (before 'strapi::body')
 */
import type { Core } from '@strapi/strapi';

const rawBody = (config: any, { strapi }: { strapi: Core.Strapi }) => {
  return async (ctx: any, next: () => Promise<void>) => {
    // Only capture raw body for the webhook endpoint (igual que express.raw())
    const url = ctx.request.url?.split('?')[0];
    if (url === '/api/bold-webhook' && ctx.request.method === 'POST') {
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve, reject) => {
        ctx.req.on('data', (chunk: Buffer) => chunks.push(chunk));
        ctx.req.on('end', () => resolve());
        ctx.req.on('error', (err: Error) => reject(err));
      });

      // Guardar como Buffer (equivalente a express.raw({ type: 'application/json' }))
      const rawBuffer = Buffer.concat(chunks);
      ctx.request.rawBody = rawBuffer;
      strapi.log.info('[BoldWebhook] Raw body capturado para validación de firma');

      // Re-parse so ctx.request.body is still available
      try {
        ctx.request.body = JSON.parse(rawBuffer.toString('utf-8'));
      } catch {
        ctx.request.body = {};
      }
    }

    await next();
  };
};

export default rawBody;