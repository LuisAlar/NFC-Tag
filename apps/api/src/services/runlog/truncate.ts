/**
 * Keeps logged payloads small. Vision WEB_DETECTION responses and Wikipedia
 * pages can be large, and image bytes should never end up in a log at all.
 * Raw full payloads belong in object storage; the log keeps a readable sample.
 */

export interface TruncateOptions {
  maxString: number;
  maxArray: number;
  maxDepth: number;
}

export const DEFAULT_TRUNCATE: TruncateOptions = {
  maxString: 1000,
  maxArray: 20,
  maxDepth: 6,
};

export function truncate(value: unknown, opts: TruncateOptions = DEFAULT_TRUNCATE, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.startsWith('data:') && value.length > 100) {
      return `[data URI, ${value.length} chars omitted]`;
    }
    return value.length > opts.maxString
      ? `${value.slice(0, opts.maxString)}… [+${value.length - opts.maxString} chars]`
      : value;
  }

  if (typeof value !== 'object') return value;

  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
    return `[binary, ${(value as Uint8Array).byteLength} bytes omitted]`;
  }

  if (value instanceof Date) return value.toISOString();

  if (depth >= opts.maxDepth) return '[max depth]';

  if (Array.isArray(value)) {
    const items = value.slice(0, opts.maxArray).map((v) => truncate(v, opts, depth + 1));
    if (value.length > opts.maxArray) items.push(`[+${value.length - opts.maxArray} more items]`);
    return items;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = truncate(v, opts, depth + 1);
  }
  return out;
}
