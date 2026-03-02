import fs from 'fs';
import path from 'path';
import { ConversationState, ConversationStatus } from './types.js';

const STATE_FILE = path.join(process.cwd(), 'state.json');
const CURSOR_FILE = path.join(process.cwd(), 'cursor.json');

// ── Conversation state ─────────────────────────────────────────────────────────

function loadStates(): Record<string, ConversationState> {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStates(states: Record<string, ConversationState>): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(states, null, 2));
}

export function getState(address: string): ConversationState {
  return loadStates()[address] ?? { status: 'NEW', updatedAt: Date.now() };
}

export function setState(address: string, update: Partial<ConversationState> & { status: ConversationStatus }): void {
  const all = loadStates();
  all[address] = { ...all[address], ...update, updatedAt: Date.now() };
  saveStates(all);
}

/** On startup, returns all addresses stuck in PROCESSING and resets them to AWAITING_IPFS. */
export function resetStuckProcessing(): string[] {
  const all = loadStates();
  const stuck: string[] = [];
  for (const [address, state] of Object.entries(all)) {
    if (state.status === 'PROCESSING') {
      all[address] = { ...state, status: 'AWAITING_IPFS', updatedAt: Date.now() };
      stuck.push(address);
    }
  }
  if (stuck.length > 0) saveStates(all);
  return stuck;
}

// ── Ledger cursor (for deduplication across restarts) ─────────────────────────

export function loadCursor(): number | undefined {
  if (!fs.existsSync(CURSOR_FILE)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf-8'));
    return typeof data.cursor === 'number' ? data.cursor : undefined;
  } catch {
    return undefined;
  }
}

export function saveCursor(cursor: number): void {
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor }));
}

