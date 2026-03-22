/**
 * Middleware que captura el raw body antes de que Strapi lo parsee.
 * Necesario para la validacion HMAC-SHA256 del webhook de Bold,
 * que requiere los bytes exactos enviados por Bold.
 *
 * Registrado en config/middleware.ts ANTES de 'strapi::body'.
 */
import type { Core } from '@strapi/strapi';

const boldRawBody = (_config: unknown, { strapi }: { strapi: Core.Strapi }) => {
  return async (ctx: any, next: () => Promise<void>) => {
    const url = ctx.request.url?.split('?')[0];
    const isWebhook = url === '/api/bold-webhook' && ctx.request.method === 'POST';

    if (!isWebhook) {
      await next();
      return;
    }

    strapi.log.info('[BoldRawBody] Interceptando request al webhook de Bold');

    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      ctx.req.on('data', (chunk: Buffer) => chunks.push(chunk));
      ctx.req.on('end', () => resolve());
      ctx.req.on('error', (err: Error) => reject(err));
    });

    const rawBuffer = Buffer.concat(chunks);
    ctx.request.rawBody = rawBuffer;

    strapi.log.info(`[BoldRawBody] Raw body capturado | bytes=${rawBuffer.length}`);

    try {
      ctx.request.body = JSON.parse(rawBuffer.toString('utf-8'));
      strapi.log.info('[BoldRawBody] Body JSON parseado correctamente');
    } catch {
      strapi.log.error('[BoldRawBody] Error parseando body JSON del webhook');
      ctx.request.body = {};
    }

    await next();
  };
};

export default boldRawBody;
