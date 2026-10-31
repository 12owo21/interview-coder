import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRelay, deriveViewerToken } from './relay.mjs'

/**
 * The public relay: `RELAY_KEY=... node server.mjs`. The same key goes into the
 * app's 设置 → 手机同步; see README.md.
 */

const PORT = Number(process.env.PORT) || 8787
const RELAY_KEY = process.env.RELAY_KEY || ''
const MAX_VIEWERS = Number(process.env.MAX_VIEWERS) || 10

if (RELAY_KEY.length < 16) {
  console.error('RELAY_KEY is missing or shorter than 16 characters, refusing to start.')
  console.error('Make one with: openssl rand -hex 16')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, 'public', name))

/**
 * Read once: the page is a few small files that only change with a redeploy.
 * The app serves the same list for 局域网 (VIEWER_FILES in src/main/mobile-sync.ts)
 */
const files = {
  '/': { body: read('index.html'), type: 'text/html; charset=utf-8' },
  '/app.js': { body: read('app.js'), type: 'text/javascript; charset=utf-8' },
  '/style.css': { body: read('style.css'), type: 'text/css; charset=utf-8' },
  '/vendor/marked.umd.js': {
    body: read('vendor/marked.umd.js'),
    type: 'text/javascript; charset=utf-8'
  },
  '/vendor/highlight.min.js': {
    body: read('vendor/highlight.min.js'),
    type: 'text/javascript; charset=utf-8'
  }
}

const relay = createRelay({
  files,
  viewerToken: deriveViewerToken(RELAY_KEY),
  hostKey: RELAY_KEY,
  maxViewers: MAX_VIEWERS,
  log: (message) => console.log(new Date().toISOString(), message)
})

relay.server.listen(PORT, () => {
  console.log(`relay listening on :${PORT}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    relay.close()
    process.exit(0)
  })
}
