import 'dotenv/config';
import { initPFTClient, scanMessages, getMessage, sendMessage, uploadContent, registerBot } from './pftClient.js';
import { generateAnimationPrompt } from './visionService.js';
import { animateNFT, downloadVideo, initFal } from './animationService.js';
import { getState, setState, loadCursor, saveCursor, resetStuckProcessing, loadProcessedTxHashes, markTxProcessed } from './conversationState.js';
import { extractIPFSUrl, validateImageUrl } from './ipfsUtils.js';
import { ScannedMessage } from './types.js';

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '10000', 10);
const COST_PFT = 350;
const BOT_ADDRESS = 'rLethbCWSbYS6aeUyZRZAJHh4Hw3QNQf9w';

// Track in-flight animations so we don't double-process a user
const processingAddresses = new Set<string>();

// Persisted dedup — survives restarts
const processedTxHashes = loadProcessedTxHashes();

// ── Message processor ──────────────────────────────────────────────────────────

async function processMessage(msg: ScannedMessage): Promise<void> {
  const { sender, tx_hash } = msg;
  const amountPft = parseFloat(msg.amount_pft ?? '0');

  if (processedTxHashes.has(tx_hash)) return;
  const state = getState(sender);
  if (state.lastTx === tx_hash) return;

  let full;
  try {
    full = await getMessage(tx_hash);
  } catch (err: any) {
    console.error(`[Bot] Could not decrypt message ${tx_hash}: ${err.message}`);
    return;
  }

  // Mark processed only after successful decrypt — transient errors won't permanently bury the tx
  markTxProcessed(tx_hash, processedTxHashes);

  const text = full.message?.trim() ?? '';
  console.log(`[Bot] Message from ${sender} | ${amountPft} PFT | state=${state.status} | "${text.slice(0, 80)}"`);

  // ── State: NEW (first contact) ─────────────────────────────────────────────
  if (state.status === 'NEW') {
    const isAnimateCommand = text.toLowerCase().startsWith('/animate');

    if (isAnimateCommand && amountPft >= COST_PFT) {
      // User paid and issued /animate in their very first message — skip straight to AWAITING_IPFS
      await sendMessage({
        recipient: sender,
        reply_to_tx: tx_hash,
        thread_id: full.thread_id,
        message:
          `👋 Welcome to PFT NFT Animator!\n\n` +
          `✅ Payment of **${amountPft} PFT** received!\n\n` +
          `Now submit your NFT image URL:\n` +
          `Copy your NFT's IPFS URL and paste it after the command:\n` +
          `\`/uploadipfslink https://ipfs-testnet.postfiat.org/ipfs/YourCID\``,
      });
      setState(sender, { status: 'AWAITING_IPFS', lastTx: tx_hash });
      return;
    }

    if (isAnimateCommand && amountPft < COST_PFT) {
      // Sent /animate but forgot the PFT
      await sendMessage({
        recipient: sender,
        reply_to_tx: tx_hash,
        thread_id: full.thread_id,
        message:
          `👋 Welcome to PFT NFT Animator!\n\n` +
          `You sent \`/animate\` but only attached **${amountPft} PFT**. The cost is **350 PFT**.\n\n` +
          `Please resend \`/animate\` with **350 PFT** attached to get started.`,
      });
      setState(sender, { status: 'AWAITING', lastTx: tx_hash });
      return;
    }

    // Generic first contact — send welcome instructions
    await sendMessage({
      recipient: sender,
      reply_to_tx: tx_hash,
      thread_id: full.thread_id,
      message:
        `👋 Welcome to PFT NFT Animator!\n\n` +
        `Your NFT will be brought to life as a unique 5-second animation.\n\n` +
        `**How it works:**\n` +
        `1. Send \`/animate\` with **350 PFT** attached to pay and initiate\n` +
        `2. Reply with \`/uploadipfslink\` followed by your NFT's IPFS URL to submit your image\n` +
        `3. Receive your animation in ~60–90 seconds\n\n` +
        `When you're ready, send \`/animate\` with 350 PFT to get started.`,
    });
    setState(sender, { status: 'AWAITING', lastTx: tx_hash });
    return;
  }

  // ── State: AWAITING (waiting for /animate + 350 PFT) ────────────────────
  if (state.status === 'AWAITING') {
    const isAnimateCommand = text.toLowerCase().startsWith('/animate');

    if (!isAnimateCommand) {
      await sendMessage({
        recipient: sender,
        reply_to_tx: tx_hash,
        thread_id: full.thread_id,
        message:
          `To get started, send \`/animate\` with **350 PFT** attached to the message.`,
      });
      setState(sender, { status: 'AWAITING', lastTx: tx_hash });
      return;
    }

    if (amountPft < COST_PFT) {
      await sendMessage({
        recipient: sender,
        reply_to_tx: tx_hash,
        thread_id: full.thread_id,
        message:
          `You sent \`/animate\` but only attached **${amountPft} PFT**.\n\n` +
          `Please resend \`/animate\` with **350 PFT** attached.`,
      });
      setState(sender, { status: 'AWAITING', lastTx: tx_hash });
      return;
    }

    // Payment confirmed — ask for IPFS link
    await sendMessage({
      recipient: sender,
      reply_to_tx: tx_hash,
      thread_id: full.thread_id,
      message:
        `✅ Payment received! Now submit your NFT image.\n\n` +
        `Reply with:\n` +
        `\`/uploadipfslink <your-ipfs-url>\`\n\n` +
        `Example:\n` +
        `\`/uploadipfslink https://ipfs-testnet.postfiat.org/ipfs/YourCID\``,
    });
    setState(sender, { status: 'AWAITING_IPFS', lastTx: tx_hash });
    return;
  }

  // ── State: AWAITING_IPFS (payment done, waiting for /uploadipfslink) ───────
  if (state.status === 'AWAITING_IPFS') {
    const isUploadCommand = text.toLowerCase().startsWith('/uploadipfslink');

    if (!isUploadCommand) {
      await sendMessage({
        recipient: sender,
        reply_to_tx: tx_hash,
        thread_id: full.thread_id,
        message:
          `Payment already received! Submit your NFT image URL with:\n\n` +
          `\`/uploadipfslink https://ipfs-testnet.postfiat.org/ipfs/YourCID\``,
      });
      setState(sender, { status: 'AWAITING_IPFS', lastTx: tx_hash });
      return;
    }

    // Extract IPFS URL from the command argument
    const ipfsUrl = extractIPFSUrl(text);

    if (!ipfsUrl) {
      await sendMessage({
        recipient: sender,
        reply_to_tx: tx_hash,
        thread_id: full.thread_id,
        message:
          `I couldn't find a valid IPFS URL in your message.\n\n` +
          `Please try again:\n` +
          `\`/uploadipfslink https://ipfs-testnet.postfiat.org/ipfs/YourCID\``,
      });
      setState(sender, { status: 'AWAITING_IPFS', lastTx: tx_hash });
      return;
    }

    // Validate the URL points to an actual image
    console.log(`[Bot] Validating image URL: ${ipfsUrl}`);
    const validation = await validateImageUrl(ipfsUrl);
    if (!validation.valid) {
      await sendMessage({
        recipient: sender,
        reply_to_tx: tx_hash,
        thread_id: full.thread_id,
        message:
          `I couldn't load an image from that URL (${validation.error}).\n\n` +
          `Please check the link and try again with:\n` +
          `\`/uploadipfslink https://ipfs-testnet.postfiat.org/ipfs/YourCID\``,
      });
      setState(sender, { status: 'AWAITING_IPFS', lastTx: tx_hash });
      return;
    }

    // URL valid — kick off animation
    setState(sender, { status: 'PROCESSING', ipfsUrl, lastTx: tx_hash });

    await sendMessage({
      recipient: sender,
      reply_to_tx: tx_hash,
      thread_id: full.thread_id,
      message:
        `🎬 Got it! Analyzing your NFT and generating your animation now.\n\n` +
        `This takes **60–90 seconds** — I'll message you as soon as it's ready.`,
    });

    // Run animation asynchronously so the poll loop isn't blocked
    runAnimation(sender, ipfsUrl, tx_hash, full.thread_id).catch((err: Error) => {
      console.error(`[Bot] Animation failed for ${sender}: ${err.message}`);
      sendMessage({
        recipient: sender,
        thread_id: full.thread_id,
        message:
          `❌ Something went wrong generating your animation: ${err.message}\n\n` +
          `Your 350 PFT was received. Please try submitting your link again:\n` +
          `\`/uploadipfslink https://ipfs-testnet.postfiat.org/ipfs/YourCID\``,
      }).catch(console.error);
      setState(sender, { status: 'AWAITING_IPFS', lastTx: tx_hash });
    });

    return;
  }

  // ── State: PROCESSING — stay silent, delivery message will come when done ──
  if (state.status === 'PROCESSING') {
    setState(sender, { status: 'PROCESSING', lastTx: tx_hash });
    return;
  }

  // ── State: COMPLETED ──────────────────────────────────────────────────────
  if (state.status === 'COMPLETED') {
    const isAnimateCommand = text.toLowerCase().startsWith('/animate');

    if (isAnimateCommand && amountPft >= COST_PFT) {
      // User paid to start a new animation — skip straight to AWAITING_IPFS
      await sendMessage({
        recipient: sender,
        reply_to_tx: tx_hash,
        thread_id: full.thread_id,
        message:
          `✅ Payment of **${amountPft} PFT** received! Ready for your next NFT.\n\n` +
          `Copy your NFT's IPFS URL and paste it after the command:\n` +
          `\`/uploadipfslink https://ipfs-testnet.postfiat.org/ipfs/YourCID\``,
      });
      setState(sender, { status: 'AWAITING_IPFS', lastTx: tx_hash });
      return;
    }

    if (isAnimateCommand && amountPft < COST_PFT) {
      await sendMessage({
        recipient: sender,
        reply_to_tx: tx_hash,
        thread_id: full.thread_id,
        message:
          `You sent \`/animate\` but only attached **${amountPft} PFT**. The cost is **350 PFT**.\n\n` +
          `Please resend \`/animate\` with **350 PFT** attached.`,
      });
      setState(sender, { status: 'AWAITING', lastTx: tx_hash });
      return;
    }

    // Any other message — remind them how to start again
    await sendMessage({
      recipient: sender,
      reply_to_tx: tx_hash,
      thread_id: full.thread_id,
      message:
        `Your animation was already delivered! 🎬\n\n` +
        `Want to animate another NFT? Send \`/animate\` with 350 PFT to start again.`,
    });
    setState(sender, { status: 'AWAITING', lastTx: tx_hash });
  }
}

// ── Animation pipeline ────────────────────────────────────────────────────────

async function runAnimation(
  address: string,
  ipfsUrl: string,
  replyToTx: string,
  threadId: string,
): Promise<void> {
  if (processingAddresses.has(address)) {
    console.log(`[Bot] Animation already in progress for ${address}, skipping duplicate`);
    return;
  }
  processingAddresses.add(address);

  try {
    // Step 1: analyze the image with vision LLM
    console.log(`[Bot] Generating animation prompt for ${address}...`);
    const prompt = await generateAnimationPrompt(ipfsUrl);
    console.log(`[Bot] Prompt: ${prompt}`);

    // Step 2: generate video via fal.ai Kling Pro
    console.log(`[Bot] Sending to fal.ai Kling Pro...`);
    const { videoUrl } = await animateNFT(ipfsUrl, prompt);

    // Step 3: try to upload video to IPFS (max 9MB); fall back to direct URL
    let attachments: Array<{ cid: string; mime_type: string; filename: string; byte_size: number }> | undefined;
    let deliveryText = '';

    console.log(`[Bot] Downloading video to check size...`);
    const videoBuffer = await downloadVideo(videoUrl);

    if (videoBuffer) {
      console.log(`[Bot] Uploading ${videoBuffer.byteLength} bytes to IPFS...`);
      const uploaded = await uploadContent({
        content: videoBuffer.toString('base64'),
        content_type: 'video/mp4',
        encoding: 'base64',
      });
      attachments = [
        {
          cid: uploaded.cid,
          mime_type: 'video/mp4',
          filename: 'nft-animation.mp4',
          byte_size: videoBuffer.byteLength,
        },
      ];
      deliveryText = `Your animated NFT is attached to this message as an IPFS file (CID: \`${uploaded.cid}\`).`;
      console.log(`[Bot] Uploaded to IPFS: ${uploaded.cid}`);
    } else {
      // Video too large for IPFS — send the direct URL
      deliveryText = `Your animation is ready! Copy and paste the link below into your browser to view and download:\n\n${videoUrl}\n\n_(Link expires in ~24 hours — download it soon)_`;
    }

    // Step 4: deliver to user
    await sendMessage({
      recipient: address,
      thread_id: threadId,
      message:
        `🎬 **Your NFT animation is ready!**\n\n` +
        deliveryText +
        `\n\n_(If the URL appears incomplete, refresh this page and it should load correctly.)_` +
        `\n\n**Animation prompt used:**\n_${prompt}_\n\n` +
        `Want to animate another NFT? Reply with a new IPFS URL and 350 PFT.`,
      ...(attachments ? { attachments } : {}),
    });

    setState(address, { status: 'COMPLETED', ipfsUrl, animationUrl: videoUrl, lastTx: replyToTx });
    console.log(`[Bot] Animation delivered to ${address}`);
  } finally {
    processingAddresses.delete(address);
  }
}

// ── Main poll loop ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[Bot] Starting PFT NFT Animator...');
  console.log(`[Bot] Bot address: ${BOT_ADDRESS}`);

  // Validate required env vars
  for (const key of ['BOT_SEED', 'FAL_KEY', 'OPENROUTER_API_KEY']) {
    if (!process.env[key]) {
      console.error(`[Bot] ERROR: Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  // Init services
  initFal();
  await initPFTClient();

  // Register bot (once, or when FORCE_REGISTER=true)
  try {
    await registerBot();
  } catch (err: any) {
    console.warn(`[Bot] register_bot: ${err.message} (may already be registered)`);
  }

  // Reset any sessions stuck in PROCESSING from a previous run
  const stuck = resetStuckProcessing();
  for (const address of stuck) {
    console.log(`[Bot] Resetting stuck PROCESSING state for ${address}`);
    await sendMessage({
      recipient: address,
      message:
        `The bot was restarted and your animation job was lost. Your payment is still credited.\n\n` +
        `Please resubmit your NFT image with:\n\`/uploadipfslink <your-ipfs-url>\``,
    }).catch(console.error);
  }

  // Establish starting cursor — load persisted cursor or start from current tip
  let cursor = loadCursor();
  if (cursor === undefined) {
    console.log('[Bot] No saved cursor — doing initial scan to establish position...');
    const initial = await scanMessages({ limit: 1 });
    cursor = initial.next_cursor ?? undefined;
    if (cursor != null) saveCursor(cursor);
    console.log(`[Bot] Starting from ledger cursor: ${cursor ?? 'beginning'}`);
  } else {
    console.log(`[Bot] Resuming from saved ledger cursor: ${cursor}`);
  }

  console.log(`[Bot] Polling every ${POLL_INTERVAL_MS}ms — ready for messages`);

  // Main loop
  while (true) {
    try {
      const result = await scanMessages(cursor != null ? { since_ledger: cursor } : {});

      if (result.messages.length > 0) {
        console.log(`[Bot] Found ${result.messages.length} new message(s)`);
        for (const msg of result.messages) {
          await processMessage(msg);
        }
      }

      if (result.next_cursor != null && result.next_cursor !== cursor) {
        cursor = result.next_cursor;
        saveCursor(cursor);
      }
    } catch (err: any) {
      console.error(`[Bot] Poll error: ${err.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('[Bot] Fatal error:', err);
  process.exit(1);
});
