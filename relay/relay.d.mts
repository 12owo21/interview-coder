import type { Server } from 'node:http'

export interface RelayFile {
  body: string | Buffer
  type: string
}

export interface RelayOptions {
  /** The viewer page, by URL path */
  files: Record<string, RelayFile>
  /** What viewers must present */
  viewerToken: string
  /** What the host must present; without one `/host` is refused */
  hostKey?: string
  maxViewers?: number
  /** Called whenever a viewer comes or goes */
  onViewers?: (count: number) => void
  log?: (message: string) => void
}

export interface Relay {
  server: Server
  /** Hand `data` to every viewer, and to every one that connects later */
  publish: (data: unknown) => void
  /** Drop every socket and stop listening */
  close: () => void
  /** How many viewers it lets in at once */
  maxViewers: number
}

/** The largest frame the relay accepts, in bytes; a bigger one closes the socket with 1009 */
export const MAX_PAYLOAD: number
export function deriveViewerToken(key: string): string
export function createRelay(options: RelayOptions): Relay
