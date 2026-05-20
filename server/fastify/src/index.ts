import { buildApp } from './app.js'

async function main(): Promise<void> {
  const { app, config } = await buildApp()
  try {
    await app.listen({ host: config.host, port: config.port })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
