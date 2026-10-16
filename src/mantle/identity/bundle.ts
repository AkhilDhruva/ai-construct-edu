import type { CurriculumPlan } from '../engine/types'
import type { Attempt, CardState, Learner, MasteryState, TelemetryEvent } from '../store/types'

export const BUNDLE_FORMAT = 'veraclause-mantle-bundle'
export const BUNDLE_VERSION = 1
const PBKDF2_ITERATIONS = 210_000

export interface LearnerSnapshot {
  learner: Learner
  cardStates: CardState[]
  attempts: Attempt[]
  mastery: MasteryState[]
  plans: CurriculumPlan[]
  events: TelemetryEvent[]
}

/**
 * A portable copy of one learner's state. Without a passphrase the payload is plain
 * JSON with a SHA-256 checksum (catches corruption, not tampering). With a
 * passphrase, PBKDF2 derives an AES-GCM key and an HMAC key; the payload is
 * encrypted and the whole envelope is HMAC-signed, so a tampered bundle is rejected.
 */
export interface Bundle {
  format: typeof BUNDLE_FORMAT
  version: number
  learnerId: string
  exportedAt: string
  protected: boolean
  salt?: string
  iv?: string
  payload: string
  checksum?: string
  hmac?: string
}

const enc = new TextEncoder()
const dec = new TextDecoder()
const subtle = () => globalThis.crypto.subtle

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of u) s += String.fromCharCode(b)
  return btoa(s)
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function sha256(text: string): Promise<string> {
  return b64(await subtle().digest('SHA-256', enc.encode(text)))
}

async function deriveKeys(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(
    await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, base, 512),
  )
  const aes = await subtle().importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt'])
  const mac = await subtle().importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  return { aes, mac }
}

const signedPart = (b: Bundle) =>
  JSON.stringify([b.format, b.version, b.learnerId, b.exportedAt, b.protected, b.salt, b.iv, b.payload])

export async function createBundle(snapshot: LearnerSnapshot, exportedAt: string, passphrase?: string): Promise<Bundle> {
  const json = JSON.stringify(snapshot)
  const base = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    learnerId: snapshot.learner.id,
    exportedAt,
  } as const
  if (!passphrase) {
    return { ...base, protected: false, payload: json, checksum: await sha256(json) }
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const { aes, mac } = await deriveKeys(passphrase, salt)
  const cipher = await subtle().encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(json))
  const bundle: Bundle = { ...base, protected: true, salt: b64(salt), iv: b64(iv), payload: b64(cipher) }
  bundle.hmac = b64(await subtle().sign('HMAC', mac, enc.encode(signedPart(bundle))))
  return bundle
}

export class BundleError extends Error {}

export async function openBundle(input: unknown, passphrase?: string): Promise<LearnerSnapshot> {
  const b = input as Partial<Bundle>
  if (!b || b.format !== BUNDLE_FORMAT) throw new BundleError('Not a Mantle export bundle.')
  if (typeof b.version !== 'number' || b.version > BUNDLE_VERSION) throw new BundleError(`Unsupported bundle version ${b.version}.`)
  if (typeof b.payload !== 'string') throw new BundleError('Bundle has no payload.')
  let json: string
  if (!b.protected) {
    if (b.checksum !== (await sha256(b.payload))) throw new BundleError('Checksum mismatch: the bundle was altered or corrupted.')
    json = b.payload
  } else {
    if (!passphrase) throw new BundleError('This bundle is passphrase-protected.')
    if (!b.salt || !b.iv || !b.hmac) throw new BundleError('Protected bundle is missing salt, iv or signature.')
    const { aes, mac } = await deriveKeys(passphrase, unb64(b.salt))
    const ok = await subtle().verify('HMAC', mac, unb64(b.hmac), enc.encode(signedPart(b as Bundle)))
    if (!ok) throw new BundleError('Signature check failed: wrong passphrase or a tampered bundle.')
    try {
      json = dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(b.iv) }, aes, unb64(b.payload)))
    } catch {
      throw new BundleError('Could not decrypt the bundle.')
    }
  }
  const snap = JSON.parse(json) as LearnerSnapshot
  if (!snap.learner?.id || snap.learner.id !== b.learnerId) throw new BundleError('Bundle learner id does not match its payload.')
  return snap
}
