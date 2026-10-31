import { createServer } from 'node:http'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { WebSocketServer, WebSocket } from 'ws'

/**
 * Relay between the desktop app (the host) and the phones (the viewers).
 *
 * Used twice: by `server.mjs` on a public server, where the app connects as the
 * host over WebSocket, and inside the app itself for 局域网 mode, where the app
 * calls `publish()` directly and there is no host socket.
 *
 * The host sends its whole state whenever it changes; the relay keeps the
 * latest one and hands it to every viewer, a late or reconnecting one included.
 * Whole states instead of deltas: a phone that drops off for a minute misses
 * nothing, there is nothing to replay or to get out of order.
 *
 * Frames (JSON text):
 *   host   → relay   { type: 'state', data }
 *   relay  → host    { type: 'viewers', count }
 *   relay  → viewer  { type: 'state', data } | { type: 'host', online }
 * The relay never looks inside `data`, so the app can grow its state freely.
 *
 * Auth: one secret key. The host presents it as a bearer token; viewers present
 * `deriveViewerToken(key)`, so the QR code on a phone never holds the key
 * itself. One key means one room — a map of rooms keyed by it would be the way
 * to more.
 */

/**
 * One state is a few KB; a long conversation stays far below this. The app
 * checks its frames against it before sending, since a server deployed earlier
 * keeps its own copy
 */
export const MAX_PAYLOAD = 1024 * 1024
const PING_INTERVAL = 25_000
/**
 * A state is resent whole on every change and is mostly repeated text, so it
 * compresses several times over — what matters to a phone on mobile data.
 * Small frames are not worth the CPU
 */
const PER_MESSAGE_DEFLATE = { threshold: 1024 }

/** What a viewer presents for `key`. Both the app and the server derive it, so neither stores it */
export function deriveViewerToken(key) {
  return createHmac('sha256', key).update('viewer').digest('hex').slice(0, 32)
}

/**
 * A request's path and query, or null when `URL` cannot parse the target: `//[`
 * reads as a host, and an uncaught throw here would take the server down for
 * anyone who sends it, before any key is checked
 */
function parseTarget(req) {
  try {
    return new URL(req.url || '/', 'http://localhost')
  } catch {
    return null
  }
}

function same(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The page holds no secret, so it is public; the token travels in the URL
 * fragment and only the page's own requests send it. The CSP is for the
 * markdown the page renders: whatever the model (or a screenshot's prompt
 * injection) writes can neither run script nor load a remote image.
 * `media-src data:` is for the keep-awake clip app.js carries inline; the
 * markdown cannot add a <video> of its own, its raw HTML is shown as text.
 */
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'"

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-cache'
}

/**
 * @param {object} options
 * @param {Record<string, { body: string | Buffer, type: string }>} options.files The viewer page, by URL path
 * @param {string} options.viewerToken What viewers must present
 * @param {string} [options.hostKey] What the host must present; without one `/host` is refused
 * @param {number} [options.maxViewers]
 * @param {(count: number) => void} [options.onViewers] Called whenever a viewer comes or goes
 * @param {(message: string) => void} [options.log]
 */
export function createRelay({
  files,
  viewerToken,
  hostKey = '',
  maxViewers = 10,
  onViewers = () => {},
  log = () => {}
}) {
  // Compressed and fingerprinted once: the files only change with a redeploy,
  // and `no-cache` then costs a phone a 304 instead of the whole page
  const served = {}
  for (const [path, { body, type }] of Object.entries(files)) {
    const buffer = Buffer.from(body)
    served[path] = {
      type,
      body: buffer,
      gzip: gzipSync(buffer),
      etag: `"${createHash('sha1').update(buffer).digest('base64url')}"`
    }
  }

  const server = createServer((req, res) => {
    const url = parseTarget(req)
    if (!url) {
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request')
      return
    }
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
      return
    }
    // Lets the page tell an expired QR code or a full house from a network
    // that is down: a WebSocket refused at the upgrade only reports that it closed
    if (url.pathname === '/check') {
      if (!same(url.searchParams.get('t') || '', viewerToken)) {
        res.writeHead(401, SECURITY_HEADERS).end()
      } else if (viewers.size >= maxViewers) {
        res
          .writeHead(503, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' })
          .end(JSON.stringify({ maxViewers }))
      } else {
        res.writeHead(204, SECURITY_HEADERS).end()
      }
      return
    }
    const file = req.method === 'GET' ? served[url.pathname] : undefined
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
      return
    }
    const headers = { 'Content-Type': file.type, ETag: file.etag, Vary: 'Accept-Encoding' }
    if (req.headers['if-none-match'] === file.etag) {
      res.writeHead(304, { ...headers, ...SECURITY_HEADERS }).end()
      return
    }
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.writeHead(200, { ...headers, ...SECURITY_HEADERS, 'Content-Encoding': 'gzip' })
      res.end(file.gzip)
      return
    }
    res.writeHead(200, { ...headers, ...SECURITY_HEADERS }).end(file.body)
  })

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD,
    perMessageDeflate: PER_MESSAGE_DEFLATE
  })

  /** @type {WebSocket | null} */
  let host = null
  /** The latest `state` frame, serialised once for every viewer; null until there is one */
  let lastState = null
  /** @type {Set<WebSocket>} */
  const viewers = new Set()

  /** In-process (局域网) the app itself is the host, so it is online for as long as the relay runs */
  const hostOnline = () => !hostKey || host !== null

  function sendJSON(socket, message) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  function viewersChanged() {
    onViewers(viewers.size)
    if (host) sendJSON(host, { type: 'viewers', count: viewers.size, max: maxViewers })
  }

  function reject(socket, status, text) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`)
    socket.destroy()
  }

  function publish(data) {
    lastState = JSON.stringify({ type: 'state', data })
    for (const viewer of viewers) {
      if (viewer.readyState === WebSocket.OPEN) viewer.send(lastState)
    }
  }

  server.on('upgrade', (req, socket, head) => {
    const url = parseTarget(req)
    if (!url) return reject(socket, 400, 'Bad Request')

    if (url.pathname === '/host' && hostKey) {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] || ''
      if (!same(bearer, hostKey)) return reject(socket, 401, 'Unauthorized')
      wss.handleUpgrade(req, socket, head, (ws) => onHost(ws))
      return
    }

    if (url.pathname === '/view') {
      if (!same(url.searchParams.get('t') || '', viewerToken)) {
        return reject(socket, 401, 'Unauthorized')
      }
      if (viewers.size >= maxViewers) return reject(socket, 503, 'Too many viewers')
      wss.handleUpgrade(req, socket, head, (ws) => onViewer(ws))
      return
    }

    reject(socket, 404, 'Not Found')
  })

  function onHost(ws) {
    // A second app instance (or a reconnect that beat the old socket's timeout)
    // takes over; the old one must not keep feeding viewers
    if (host) host.close(4000, 'replaced')
    host = ws
    log('host connected')
    for (const viewer of viewers) sendJSON(viewer, { type: 'host', online: true })
    sendJSON(ws, { type: 'viewers', count: viewers.size, max: maxViewers })

    ws.on('message', (raw) => {
      if (host !== ws) return
      let message
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (message?.type === 'state') publish(message.data)
    })

    ws.on('close', () => {
      // Only if still the current one: a replaced host closing is not "offline"
      if (host !== ws) return
      host = null
      log('host disconnected')
      for (const viewer of viewers) sendJSON(viewer, { type: 'host', online: false })
    })
    ws.on('error', (error) => log(`host socket: ${error.message}`))
    watch(ws)
  }

  function onViewer(ws) {
    viewers.add(ws)
    log(`viewer connected, now ${viewers.size}`)
    sendJSON(ws, { type: 'host', online: hostOnline() })
    if (lastState) ws.send(lastState)
    viewersChanged()

    ws.on('close', () => {
      viewers.delete(ws)
      log(`viewer left, now ${viewers.size}`)
      viewersChanged()
    })
    ws.on('error', (error) => log(`viewer socket: ${error.message}`))
    watch(ws)
  }

  /** Sockets that stop answering pings are dead (a phone out of range closes nothing) */
  function watch(ws) {
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })
  }

  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      ws.ping()
    }
  }, PING_INTERVAL)

  function close() {
    clearInterval(pinger)
    for (const ws of wss.clients) ws.terminate()
    server.close()
  }

  return { server, publish, close, maxViewers }
}
