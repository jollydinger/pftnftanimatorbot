import { fal } from '@fal-ai/client';
import type { QueueStatus } from '@fal-ai/client';
import { toHttpUrl } from './ipfsUtils.js';
import { AnimationResult } from './types.js';

// Kling v2.1 Pro image-to-video — best motion coherence, cinema-grade
const KLING_MODEL = 'fal-ai/kling-video/v2.1/pro/image-to-video';

// Max video bytes we'll attempt to upload to IPFS (10MB hard limit on PFT MCP)
const IPFS_SIZE_LIMIT_BYTES = 9 * 1024 * 1024; // 9 MB to leave headroom

export function initFal(): void {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL_KEY is not set');
  fal.config({ credentials: key });
}

/**
 * Sends the NFT image to Kling Pro and returns the generated video URL + prompt used.
 * Estimated cost: ~$0.14 per 5-second video.
 */
export async function animateNFT(ipfsUrl: string, prompt: string): Promise<AnimationResult> {
  const httpUrl = toHttpUrl(ipfsUrl);

  console.log(`[fal.ai] Starting Kling Pro animation`);
  console.log(`[fal.ai] Prompt: ${prompt}`);

  const result = await fal.subscribe(KLING_MODEL, {
    input: {
      image_url: httpUrl,
      prompt,
      duration: '5',
      negative_prompt: 'blur, low quality, watermark, text overlay, artifacts',
      cfg_scale: 0.5,
    },
    logs: true,
    onQueueUpdate: (update: QueueStatus) => {
      if (update.status === 'IN_PROGRESS') {
        const logs = (update as any).logs as Array<{ message: string }> | undefined;
        const msgs = logs?.map((l) => l.message).filter(Boolean).join(' ') ?? '';
        if (msgs) console.log(`[fal.ai] ${msgs}`);
      } else {
        console.log(`[fal.ai] Status: ${update.status}`);
      }
    },
  });

  const videoUrl: string | undefined = (result.data as any)?.video?.url;
  if (!videoUrl) throw new Error('fal.ai returned no video URL');

  console.log(`[fal.ai] Done: ${videoUrl}`);
  return { videoUrl, prompt };
}

/**
 * Downloads the video and returns it as a Buffer.
 * Returns null if the video is too large for IPFS upload.
 */
export async function downloadVideo(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Failed to download video: HTTP ${res.status}`);

  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > IPFS_SIZE_LIMIT_BYTES) {
    console.log(`[fal.ai] Video too large for IPFS (${contentLength} bytes), will send direct URL`);
    return null;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > IPFS_SIZE_LIMIT_BYTES) {
    console.log(`[fal.ai] Video too large for IPFS (${buffer.byteLength} bytes), will send direct URL`);
    return null;
  }

  return buffer;
}
