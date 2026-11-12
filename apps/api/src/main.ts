/**
 * The entry point.
 *
 * One image, two roles. The `api` role serves the API the console talks
 * to; the `worker` role looks for secrets. They share the code and the
 * database, and nothing else.
 */

import Fastify from 'fastify'

import { createPool, migrate, readSettings, Store, type Settings } from '@sentinel/core'

import { AuthError, Authenticator, type Actor } from './auth.js'
import { registerRoutes } from './routes.js'
import { Worker } from './worker.js'

/** The prefix every route is served under. The console's proxy keeps it. */
export const API_PREFIX = '/api/v1'

/**
 * Build the server.
 *
 * It is exported so a test can drive it without binding a port.
 */
export async function buildServer(settings: Settings) {
  const pool = createPool(settings.databaseUrl)
  await migrate(pool)

  const store = new Store(pool)
  const authenticator = new Authenticator(settings, store)

  const app = Fastify({
    logger: { level: settings.logLevel },
    // The console's own server is in front and forwards the request: the
    // protocol and the address the browser used are in the forwarded
    // headers, and the authorisation callback is built from them.
    trustProxy: true,
    // The console is served from another origin only in development; in a
    // deployment the console's own proxy puts everything on one origin.
    disableRequestLogging: false,
  })

  app.decorateRequest('actor', null)

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === `${API_PREFIX}/health`) return
    try {
      const actor = await authenticator.authenticate(request)
      ;(request as typeof request & { actor: Actor }).actor = actor
    } catch (error) {
      if (error instanceof AuthError) {
        await reply.code(error.statusCode).send({ error: error.message })
        return reply
      }
      throw error
    }
  })

  await app.register(
    async (instance) => {
      await registerRoutes(instance, { settings, store })
    },
    { prefix: API_PREFIX },
  )

  app.addHook('onClose', async () => {
    await pool.end()
  })

  return { app, pool, store }
}

/** Run the service. */
async function main(): Promise<void> {
  const settings = readSettings()
  const role = process.env.ROLE?.trim() || 'api'

  if (role === 'worker') {
    const pool = createPool(settings.databaseUrl)
    await migrate(pool)
    const store = new Store(pool)
    const worker = new Worker(settings, store)
    const stop = () => worker.stop()
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
    await worker.run()
    await pool.end()
    return
  }

  const { app } = await buildServer(settings)
  await app.listen({ port: settings.apiPort, host: '0.0.0.0' })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
