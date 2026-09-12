#!/usr/bin/env node
import { config } from './config.js';
import { buildServer } from './server.js';
import { restore, persist, state } from './store/state.js';
import { seedAll } from './store/seed.js';
import { start as startEngine, stop as stopEngine } from './sim/engine.js';

/**
 * Entry point: restore or seed the state, start the simulation engine and
 * listen.
 */

/**
 * Boot the mock.
 *
 * @returns {Promise<import('fastify').FastifyInstance>} The listening server.
 */
async function main() {
  const restored = restore();
  const seeded = restored ? null : seedAll();

  const app = await buildServer();
  startEngine();

  await app.listen({ host: config.host, port: config.port });

  app.log.info(
    {
      baseUrl: `http://localhost:${config.port}${config.basePath}`,
      controlPlane: `http://localhost:${config.port}/__mock`,
      apiKeys: config.apiKeys,
      catalogue: state.catalogue.length,
      restored,
      seeded,
    },
    'eSIM Go v2.5 mock ready',
  );

  /**
   * Stop the engine, persist the state if configured, and close the server.
   *
   * @param {string} signal Signal that triggered the shutdown.
   * @returns {Promise<void>}
   */
  const shutdown = async (signal) => {
    app.log.info({ signal }, 'shutting down');
    stopEngine();
    try {
      persist();
    } catch (error) {
      app.log.error({ err: error }, 'failed to persist state');
    }
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return app;
}

main().catch((error) => {
  console.error('failed to start:', error);
  process.exit(1);
});
