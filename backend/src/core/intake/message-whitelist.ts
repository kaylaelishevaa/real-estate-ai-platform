/**
 * Whitelist-fails-closed input filter — the phantom-record fix.
 *
 * Meta's WhatsApp webhook delivers every event type to the same endpoint:
 * text, image, but also audio, video, sticker, location, contacts, reactions,
 * system notifications, and types that don't exist yet. The original bug: code
 * that branched on the types it knew and silently fell through on the rest, so
 * an agent sharing their location or reacting with 👍 could advance a
 * conversation and create a half-empty "phantom" listing.
 *
 * The fix is to fail CLOSED: accept ONLY an explicit allowlist, reject
 * everything else — including malformed payloads and unknown future types.
 * Adding a new supported type is a deliberate one-line change here, not an
 * accident of control flow.
 */

import type { InboundMessage } from '../types';

/** The only message types the pipeline will act on. */
export const ALLOWED_MESSAGE_TYPES = ['text', 'image'] as const;
export type AllowedMessageType = (typeof ALLOWED_MESSAGE_TYPES)[number];

export type WhitelistResult =
  | { accepted: true; type: AllowedMessageType; message: InboundMessage }
  | { accepted: false; reason: string };

const ALLOWED = new Set<string>(ALLOWED_MESSAGE_TYPES);

/**
 * Decide whether an inbound message may enter the pipeline.
 * Fails closed: anything not explicitly allowed is rejected with a reason.
 */
export function filterInbound(message: unknown): WhitelistResult {
  if (message == null || typeof message !== 'object') {
    return { accepted: false, reason: 'malformed: not an object' };
  }
  const m = message as Partial<InboundMessage>;

  if (typeof m.type !== 'string' || m.type === '') {
    return { accepted: false, reason: 'malformed: missing type' };
  }
  if (!ALLOWED.has(m.type)) {
    return { accepted: false, reason: `unsupported message type: ${m.type}` };
  }
  // A text message with no body carries no listing data — reject rather than
  // create an empty draft.
  if (m.type === 'text' && (typeof m.text !== 'string' || m.text.trim() === '')) {
    return { accepted: false, reason: 'empty text body' };
  }
  if (m.type === 'image' && (typeof m.mediaId !== 'string' || m.mediaId === '')) {
    return { accepted: false, reason: 'image without media id' };
  }

  return { accepted: true, type: m.type as AllowedMessageType, message: m as InboundMessage };
}
