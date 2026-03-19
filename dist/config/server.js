"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config = ({ env }) => ({
    host: env('HOST', '0.0.0.0'),
    port: env.int('PORT', 1337),
    app: {
        keys: env.array('APP_KEYS'),
    },
    cron: {
        enabled: true,
        tasks: {
            // Limpiar donaciones pendientes abandonadas (diario a las 3 AM)
            '0 3 * * *': async ({ strapi }) => {
                const uid = 'api::donation.donation';
                const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
                const stale = await strapi.documents(uid).findMany({
                    filters: {
                        status: 'pending',
                        createdAt: { $lt: cutoff },
                    },
                });
                for (const record of stale) {
                    await strapi.documents(uid).delete({ documentId: record.documentId });
                }
                if (stale.length > 0) {
                    strapi.log.info(`[Cron] Eliminadas ${stale.length} donaciones pendientes abandonadas (>48h)`);
                }
            },
        },
    },
});
exports.default = config;
