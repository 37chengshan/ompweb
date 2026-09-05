/**
 * Attachment limits shared by the browser composer and both agent routes.
 *
 * Next buffers requests before route handlers run, so per-image limits alone
 * are misleading: several individually-valid images can still produce a JSON
 * body that the route never gets to validate. Keep all limits here so the UI
 * can preserve a too-large draft instead of first creating an optimistic turn
 * and then receiving a 413 response.
 */

/** Complete JSON body accepted by POST /api/agent/[id] and /api/agent/new. */
export const MAX_AGENT_COMMAND_REQUEST_BYTES = 8 * 1024 * 1024;
/** Decoded bytes across all image attachments in one prompt. */
export const MAX_TOTAL_ATTACHED_IMAGE_BYTES = 5 * 1024 * 1024;
/** One image may use the whole aggregate image budget. */
export const MAX_ATTACHED_IMAGE_BYTES = MAX_TOTAL_ATTACHED_IMAGE_BYTES;
export const MAX_ATTACHED_IMAGES = 10;

/** JSON overhead per image entry, including its discriminant and MIME field. */
const IMAGE_ENTRY_OVERHEAD_BYTES = 96;
/** Prompt command metadata plus the enclosing JSON object. */
const COMMAND_ENVELOPE_BYTES = 256;

export interface Base64ImageAttachment {
  data: string;
  mimeType: string;
}

function megabytes(bytes: number): number {
  return bytes / (1024 * 1024);
}

function isBase64DataChar(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a)
    || (code >= 0x61 && code <= 0x7a)
    || (code >= 0x30 && code <= 0x39)
    || code === 0x2b
    || code === 0x2f;
}

export function getBase64DecodedByteLength(data: string): number | null {
  if (!data || data.length % 4 !== 0) return null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const dataEnd = data.length - padding;
  for (let index = 0; index < dataEnd; index += 1) {
    if (!isBase64DataChar(data.charCodeAt(index))) return null;
  }
  for (let index = dataEnd; index < data.length; index += 1) {
    if (data[index] !== "=") return null;
  }
  return (data.length / 4) * 3 - padding;
}

function getImageByteLengthWithinLimits(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const image = value as Partial<Base64ImageAttachment>;
  if (typeof image.data !== "string" || typeof image.mimeType !== "string" || !image.mimeType.startsWith("image/")) {
    return null;
  }
  const bytes = getBase64DecodedByteLength(image.data);
  return bytes !== null && bytes <= MAX_ATTACHED_IMAGE_BYTES ? bytes : null;
}

export function isBase64ImageWithinLimits(value: unknown): value is Base64ImageAttachment {
  return getImageByteLengthWithinLimits(value) !== null;
}

/** Count, per-image, and aggregate limits shared by server validation and UI preflight. */
function validateImageBudget(images: readonly unknown[]): string | null {
  if (images.length > MAX_ATTACHED_IMAGES) {
    return `A message can include at most ${MAX_ATTACHED_IMAGES} images`;
  }
  let totalBytes = 0;
  for (const image of images) {
    const bytes = getImageByteLengthWithinLimits(image);
    if (bytes === null) {
      return `Each image must be valid base64 image data of ${megabytes(MAX_ATTACHED_IMAGE_BYTES)}MB or smaller`;
    }
    totalBytes += bytes;
  }
  if (totalBytes > MAX_TOTAL_ATTACHED_IMAGE_BYTES) {
    return `Attached images must total ${megabytes(MAX_TOTAL_ATTACHED_IMAGE_BYTES)}MB or less`;
  }
  return null;
}

/** Return an API-safe error for prompt, steering, and follow-up image arrays. */
export function validateAgentImages(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "images must be an array";
  for (const image of value) {
    if (!image || typeof image !== "object" || (image as { type?: unknown }).type !== "image") {
      return "Each attachment must be an image";
    }
  }
  return validateImageBudget(value);
}

/** UTF-8 bytes of a string after JSON escaping. */
function jsonStringByteLength(value: string): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Estimate the wire body generated for an outgoing prompt. Base64 is ASCII,
 * so its exact JSON cost is its character length. */
export function getAgentRequestByteLength(message: string, images: readonly Base64ImageAttachment[] = []): number {
  let bytes = COMMAND_ENVELOPE_BYTES + jsonStringByteLength(message);
  for (const image of images) {
    bytes += IMAGE_ENTRY_OVERHEAD_BYTES + image.data.length + jsonStringByteLength(image.mimeType);
  }
  return bytes;
}

/** Final browser-side prompt gate. Server-side validation remains authoritative. */
export function validateOutgoingPrompt(
  message: string,
  images: readonly Base64ImageAttachment[] = [],
): string | null {
  const imageError = validateImageBudget(images);
  if (imageError) return imageError;
  if (getAgentRequestByteLength(message, images) > MAX_AGENT_COMMAND_REQUEST_BYTES) {
    return `This message is too large to send: keep it under ${megabytes(MAX_AGENT_COMMAND_REQUEST_BYTES)}MB including attachments.`;
  }
  return null;
}
