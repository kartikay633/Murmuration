/**
 * Murmuration wire protocol.
 *
 * One WebSocket per browser tab carries any number of documents. Every binary
 * frame starts with a message type and the document it belongs to:
 *
 *   [type: varUint][docName: varString][payload...]
 *
 * Document names: "page:<uuid>" for page bodies, "tree:<workspaceId>" for a
 * workspace's page tree. SYNC payloads use the standard Yjs sync encoding
 * (step 1 / step 2 / update); AWARENESS payloads use the y-protocols awareness
 * encoding. Framing, subscriptions, roles, acks and errors are ours.
 */
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import type { Role } from './roles'
import { isRole } from './roles'

export const MSG = {
  /** client <-> server: Yjs sync step 1, step 2 or update */
  SYNC: 0,
  /** client <-> server: presence (cursor, selection, user) */
  AWARENESS: 1,
  /** client -> server: start receiving a document */
  SUBSCRIBE: 2,
  /** client -> server: stop receiving a document */
  UNSUBSCRIBE: 3,
  /** server -> client: the caller's role on a document */
  ROLE: 4,
  /** server -> client: everything this client sent for a document is stored */
  SAVED: 5,
  /** server -> client: a request was refused */
  ERROR: 6,
  /** client -> server: first frame on a new socket, carries the sync token */
  AUTH: 7,
  /** server -> client: token accepted; subscriptions may follow */
  READY: 8,
  /** server -> client: something outside the document changed (JSON payload, see LiveEvent) */
  EVENT: 9,
} as const

/**
 * Changes that live in Postgres rather than in a Yjs document. The web app
 * publishes them with NOTIFY; sync servers LISTEN and forward them to the
 * affected sockets.
 */
export type LiveEvent =
  | { kind: 'comments'; pageId: string }
  | { kind: 'inbox'; userIds: string[] }

export function encodeEvent(docName: string, payload: object): Uint8Array {
  const enc = frame(MSG.EVENT, docName)
  encoding.writeVarString(enc, JSON.stringify(payload))
  return encoding.toUint8Array(enc)
}
export type MsgType = (typeof MSG)[keyof typeof MSG]

/** Sub-types inside a SYNC payload (same numbering as y-protocols/sync). */
export const SYNC_STEP_1 = 0
export const SYNC_STEP_2 = 1
export const SYNC_UPDATE = 2

export const ERR = {
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not-found',
  BAD_MESSAGE: 'bad-message',
} as const
export type ErrorCode = (typeof ERR)[keyof typeof ERR]

/** WebSocket close codes we use (4000-4999 is the application range). */
export const CLOSE = {
  UNAUTHORIZED: 4401,
} as const

/** The token is sent in the first frame rather than the URL, so it never lands in access logs. */
export function encodeAuth(token: string): Uint8Array {
  const enc = frame(MSG.AUTH, '')
  encoding.writeVarString(enc, token)
  return encoding.toUint8Array(enc)
}

export type DocKind = 'page' | 'tree'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const DOC_RE = new RegExp(`^(page|tree):(${UUID})$`)

export function parseDocName(name: string): { kind: DocKind; id: string } | null {
  const m = DOC_RE.exec(name)
  return m ? { kind: m[1] as DocKind, id: m[2]! } : null
}
export const pageDoc = (pageId: string) => `page:${pageId}`
export const treeDoc = (workspaceId: string) => `tree:${workspaceId}`

/** Start a frame; the caller appends the payload. */
export function frame(type: MsgType, docName: string): encoding.Encoder {
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, type)
  encoding.writeVarString(enc, docName)
  return enc
}

export function readHeader(data: Uint8Array): { type: number; docName: string; dec: decoding.Decoder } {
  const dec = decoding.createDecoder(data)
  const type = decoding.readVarUint(dec)
  const docName = decoding.readVarString(dec)
  return { type, docName, dec }
}

export function encodeRole(docName: string, role: Role): Uint8Array {
  const enc = frame(MSG.ROLE, docName)
  encoding.writeVarString(enc, role)
  return encoding.toUint8Array(enc)
}
export function decodeRole(dec: decoding.Decoder): Role | null {
  const r = decoding.readVarString(dec)
  return isRole(r) ? r : null
}

export function encodeError(docName: string, code: ErrorCode, message: string): Uint8Array {
  const enc = frame(MSG.ERROR, docName)
  encoding.writeVarString(enc, code)
  encoding.writeVarString(enc, message)
  return encoding.toUint8Array(enc)
}
export function decodeError(dec: decoding.Decoder): { code: string; message: string } {
  return { code: decoding.readVarString(dec), message: decoding.readVarString(dec) }
}

export function encodeEmpty(type: MsgType, docName: string): Uint8Array {
  return encoding.toUint8Array(frame(type, docName))
}

/**
 * Both sides count the SYNC step-2 and update frames a client sends for each
 * document. SAVED carries the highest count the server has durably stored, so
 * the client knows exactly which of its edits are safe.
 */
export function encodeSaved(docName: string, seq: number): Uint8Array {
  const enc = frame(MSG.SAVED, docName)
  encoding.writeVarUint(enc, seq)
  return encoding.toUint8Array(enc)
}
