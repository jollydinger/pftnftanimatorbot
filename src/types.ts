// ── Conversation state machine ────────────────────────────────────────────────

export type ConversationStatus =
  | 'NEW'               // never messaged us before
  | 'AWAITING'          // greeted, waiting for /animate + 1,000 PFT
  | 'AWAITING_IPFS'     // payment received, waiting for /uploadipfslink
  | 'PROCESSING'        // animation job running
  | 'COMPLETED';        // animation delivered

export interface ConversationState {
  status: ConversationStatus;
  lastTx?: string;      // most recent inbound tx_hash we processed
  ipfsUrl?: string;     // IPFS URL they submitted
  animationUrl?: string; // fal.ai output URL
  updatedAt: number;
}

// ── MCP tool response shapes ──────────────────────────────────────────────────

export interface ScannedMessage {
  tx_hash: string;
  sender: string;
  recipient: string;
  amount_pft: string;   // human-readable, e.g. "1000"
  amount_drops: string;
  is_encrypted: boolean;
  timestamp_iso: string;
}

export interface ScanResult {
  messages: ScannedMessage[];
  count: number;
  next_cursor?: number;
  hint?: string;
}

export interface FullMessage {
  tx_hash: string;
  cid: string;
  sender: string;
  recipient: string;
  message: string;       // decrypted text content
  content_type: string;
  amount_drops: string;
  thread_id: string;
  timestamp: string | null;
}

export interface UploadResult {
  cid: string;
  uri: string;
  content_type: string;
  size: number;
}

export interface SendResult {
  tx_hash: string;
  cid: string;
  thread_id: string;
  recipient: string;
  amount_pft: string;
  amount_drops: string;
}

// ── fal.ai / animation ────────────────────────────────────────────────────────

export interface AnimationResult {
  videoUrl: string;
  prompt: string;
}
