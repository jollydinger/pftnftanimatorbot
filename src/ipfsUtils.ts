// ── IPFS URL utilities ─────────────────────────────────────────────────────────

const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

/** Extract an IPFS URL or CID from arbitrary message text. */
export function extractIPFSUrl(text: string): string | null {
  // ipfs:// protocol
  const ipfsProto = text.match(/ipfs:\/\/[a-zA-Z0-9]+[^\s,)"]*/);
  if (ipfsProto) return ipfsProto[0];

  // https://...../ipfs/<CID>
  const gatewayUrl = text.match(/https?:\/\/[^\s,)"]*\/ipfs\/[a-zA-Z0-9]+[^\s,)"]*/);
  if (gatewayUrl) return gatewayUrl[0];

  // bare CIDv0 (Qm...)
  const cidV0 = text.match(/\bQm[1-9A-HJ-NP-Za-km-z]{44,}\b/);
  if (cidV0) return `ipfs://${cidV0[0]}`;

  // bare CIDv1 (bafy...)
  const cidV1 = text.match(/\bbafy[a-z2-7]{50,}\b/);
  if (cidV1) return `ipfs://${cidV1[0]}`;

  return null;
}

/** Convert any IPFS URL format to an https:// gateway URL for HTTP fetching. */
export function toHttpUrl(url: string): string {
  if (url.startsWith('ipfs://')) {
    const cid = url.slice(7);
    return `${IPFS_GATEWAYS[0]}${cid}`;
  }
  return url;
}

/** Validate that a URL is reachable and looks like an image. */
export async function validateImageUrl(url: string): Promise<{ valid: boolean; contentType?: string; error?: string }> {
  const httpUrl = toHttpUrl(url);
  try {
    const res = await fetch(httpUrl, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.startsWith('image/')) {
      return { valid: false, error: `Expected an image, got ${ct}` };
    }
    return { valid: true, contentType: ct };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}
