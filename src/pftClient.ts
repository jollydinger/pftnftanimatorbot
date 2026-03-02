import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ScanResult,
  FullMessage,
  UploadResult,
  SendResult,
} from './types.js';

let client: Client | null = null;

// ── Init ───────────────────────────────────────────────────────────────────────

export async function initPFTClient(): Promise<void> {
  const seed = process.env.BOT_SEED;
  if (!seed) throw new Error('BOT_SEED is not set in environment');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['@postfiatorg/pft-chatbot-mcp'],
    env: {
      ...process.env as Record<string, string>,
      BOT_SEED: seed,
    },
  });

  client = new Client({ name: 'pft-nft-animation-bot', version: '1.0.0' });
  await client.connect(transport);
  console.log('[PFT] MCP client connected');
}

// ── Internal helper ───────────────────────────────────────────────────────────

async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!client) throw new Error('PFT client not initialized — call initPFTClient() first');

  const result = await client.callTool({ name, arguments: args });

  if (result.isError) {
    const errText = (result.content as any[]).map((c: any) => c.text ?? '').join(' ');
    throw new Error(`MCP tool "${name}" error: ${errText}`);
  }

  const textContent = (result.content as any[]).find((c: any) => c.type === 'text');
  if (!textContent?.text) throw new Error(`MCP tool "${name}" returned no text content`);

  return JSON.parse(textContent.text) as T;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Scan inbound messages. Pass since_ledger to avoid re-processing. */
export async function scanMessages(params: {
  since_ledger?: number;
  limit?: number;
} = {}): Promise<ScanResult> {
  return callTool<ScanResult>('scan_messages', {
    direction: 'inbound',
    limit: params.limit ?? 100,
    ...(params.since_ledger !== undefined ? { since_ledger: params.since_ledger } : {}),
  });
}

/** Decrypt and fetch a full message by transaction hash. */
export async function getMessage(txHash: string): Promise<FullMessage> {
  return callTool<FullMessage>('get_message', { tx_hash: txHash });
}

/** Upload binary content (base64-encoded) to IPFS via Keystone gateway. */
export async function uploadContent(params: {
  content: string;        // base64-encoded binary
  content_type: string;
  encoding: 'base64';
}): Promise<UploadResult> {
  return callTool<UploadResult>('upload_content', params);
}

/** Send an encrypted on-chain message, optionally with IPFS attachments. */
export async function sendMessage(params: {
  recipient: string;
  message: string;
  reply_to_tx?: string;
  thread_id?: string;
  attachments?: Array<{
    cid: string;
    mime_type: string;
    filename?: string;
    byte_size?: number;
    is_encrypted?: boolean;
  }>;
}): Promise<SendResult> {
  return callTool<SendResult>('send_message', params as Record<string, unknown>);
}

/** Register the bot in the public PFT agent directory. */
export async function registerBot(): Promise<void> {
  await callTool('register_bot', {
    name: 'PFT NFT Animator',
    description: 'Animates your PFT NFT into a contextual full-motion video. Send your NFT\'s IPFS image URL with 350 PFT and receive a custom animation based on your NFT\'s contents.',
    capabilities: ['image-to-video', 'nft-animation', 'ipfs', 'ai-generation'],
    icon_emoji: '🎬',
    icon_color_hex: '8B5CF6',
    min_cost_first_message_drops: '0',   // free to start conversation
    commands: [
      {
        command: '/animate',
        example: '/animate',
        description: 'Initiate an NFT animation. Attach 350 PFT to this message to pay and begin.',
        min_cost_drops: '350000000', // 350 PFT (1 PFT = 1,000,000 drops)
      },
      {
        command: '/uploadipfslink',
        example: '/uploadipfslink https://ipfs-testnet.postfiat.org/ipfs/YourCID',
        description: 'Submit your NFT IPFS image URL after paying with /animate.',
        min_cost_drops: '0',
      },
    ],
  });
  console.log('[PFT] Bot registered in agent directory');
}
