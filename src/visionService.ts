import { toHttpUrl } from './ipfsUtils.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
// claude-sonnet-4-5 has vision + strong contextual understanding
const VISION_MODEL = 'anthropic/claude-sonnet-4-5';

/**
 * Analyzes the NFT image and returns a specific, action-oriented animation
 * prompt for Kling Pro image-to-video generation.
 */
export async function generateAnimationPrompt(ipfsUrl: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const httpUrl = toHttpUrl(ipfsUrl);

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/pft-nft-animation-bot',
      'X-Title': 'PFT NFT Animator',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: httpUrl },
            },
            {
              type: 'text',
              text: `You are a video animation director. Analyze this NFT image and write a concise animation prompt for a video generation model.

Rules:
- Describe ONLY the motion and action — NOT the static scene
- Be specific to what's actually in the image (character, weapon, environment, creature, etc.)
- If there's a character with a weapon → they use it (fires gun, swings sword, etc.)
- If there's fire/magic/energy → it flickers, pulses, or crackles
- If there's a landscape → wind moves elements, water ripples, clouds drift
- If there's a creature → it breathes, shifts, or moves
- Cinematic quality, smooth motion, 5 seconds
- Max 80 words

Output only the animation prompt, nothing else.`,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter vision error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as any;
  const prompt = data?.choices?.[0]?.message?.content?.trim();
  if (!prompt) throw new Error('OpenRouter returned empty prompt');

  return prompt;
}
