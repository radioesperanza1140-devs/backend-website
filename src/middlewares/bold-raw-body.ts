import { Context, Next } from 'koa';

export default () => {
  return async (ctx: Context, next: Next) => {

    if (ctx.request.url === '/api/bold/webhook' && ctx.request.method === 'POST') {

      const chunks: Buffer[] = [];

      await new Promise<void>((resolve) => {
        ctx.req.on('data', (chunk) => chunks.push(chunk));
        ctx.req.on('end', () => resolve());
      });

      const rawBody = Buffer.concat(chunks).toString('utf8');

      (ctx.request as any).rawBody = rawBody;
    }

    await next();
  };
};