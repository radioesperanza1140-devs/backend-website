/**
 * Middleware que captura el raw body antes de que Strapi lo parsee.
 * Necesario para la validacion HMAC-SHA256 del webhook de Bold,
 * que requiere los bytes exactos enviados por Bold.
 *
 * Registrado en config/middleware.ts ANTES de 'strapi::body'.
 */
import { Readable } from 'stream';
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

    // Leer el stream crudo
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      ctx.req.on('data', (chunk: Buffer) => chunks.push(chunk));
      ctx.req.on('end', () => resolve());
      ctx.req.on('error', (err: Error) => reject(err));
    });

    const rawBuffer = Buffer.concat(chunks);
    strapi.log.info(`[BoldRawBody] Raw body capturado | bytes=${rawBuffer.length}`);

    // Guardar raw body para validacion HMAC en el controller
    ctx.request.rawBody = rawBuffer;

    // Recrear el stream con los mismos bytes para que strapi::body lo parsee normalmente
    const freshStream = new Readable({ read() {} });
    freshStream.push(rawBuffer);
    freshStream.push(null);
    (freshStream as any).headers = ctx.req.headers;
    ctx.req = freshStream as any;

    strapi.log.info('[BoldRawBody] Stream recreado para strapi::body');

    await next();
  };
};

export default boldRawBody;
