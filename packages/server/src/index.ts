import { buildApp } from './app'
import { createNetBoxClient } from './netbox'

const { NETBOX_URL, NETBOX_TOKEN, NETBOX_TLS_VERIFY, PORT } = process.env

if (!NETBOX_URL || !NETBOX_TOKEN) {
  console.error('NETBOX_URL and NETBOX_TOKEN must be set (see .env.example)')
  process.exit(1)
}

if (NETBOX_TLS_VERIFY === 'false') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

const app = buildApp({ netbox: createNetBoxClient(NETBOX_URL, NETBOX_TOKEN) })

const port = Number(PORT ?? 3001)
app
  .listen({ port, host: '127.0.0.1' })
  .then(() => console.log(`net3d server on http://localhost:${port}`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
