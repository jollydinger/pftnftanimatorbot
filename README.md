# PFT NFT Animator Bot

A standalone bot on the [Post Fiat (PFT)](https://postfiat.org) protocol that animates NFT images into contextual 5-second videos. The bot analyzes the contents of your NFT and generates motion that fits the scene — characters move, environments come alive, and objects behave as they should.

## Sample Output

**Input NFT:**

![Sample NFT](https://ipfs-testnet.postfiat.org/ipfs/bafybeidbnppag3f62jh3mydnvn2upbyfodn63ykngphbjd4atnbzfoeiuu)

**Output Animation:**

[▶ Watch the animated output](https://github.com/jollydinger/pftnftanimatorbot/blob/master/C9lV8ALhFkT-IAPhP9P-f_output.mp4)

---

## How It Works

1. Message the bot at `rLethbCWSbYS6aeUyZRZAJHh4Hw3QNQf9w` on the PFT network
2. Send `/animate` with **500 PFT** attached to pay and initiate
3. Reply with `/uploadipfslink <your-ipfs-url>` to submit your NFT image
4. Receive your animation in ~60–90 seconds

The bot uses a vision LLM to analyze the NFT and craft a contextual animation prompt, then generates the video via [fal.ai Kling Pro v2.1](https://fal.ai).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain messaging | [PFT Chatbot MCP](https://www.npmjs.com/package/@postfiatorg/pft-chatbot-mcp) |
| Image analysis | [Claude Sonnet](https://openrouter.ai) via OpenRouter |
| Video generation | [fal.ai — Kling Pro v2.1](https://fal.ai) (~$0.14/video) |
| Runtime | Node.js 20+ / TypeScript |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/jollydinger/pftnftanimatorbot.git
cd pftnftanimatorbot
npm install
```

### 2. Create a PFT wallet

Start the bot without a seed to generate a new wallet:

```bash
# Remove BOT_SEED from .env, then run:
npm start
# Call create_wallet via your MCP client, save the seed
```

Or use an existing XRPL-format seed (`sEd...`). Fund the wallet with at least 10 PFT to activate it on-chain.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
BOT_SEED=sEdYourBotSeedHere
FAL_KEY=your_fal_ai_key_here
OPENROUTER_API_KEY=your_openrouter_key_here
POLL_INTERVAL_MS=10000
```

- **FAL_KEY** — get from [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys)
- **OPENROUTER_API_KEY** — get from [openrouter.ai/keys](https://openrouter.ai/keys)

### 4. Run

```bash
npm start
```

On first run the bot registers itself in the PFT agent directory. It will poll for new messages every 10 seconds.

To stop all bot processes:

```bash
npm run stop
```

---

## Project Structure

```
src/
├── index.ts              # Main poll loop and conversation state machine
├── pftClient.ts          # MCP client wrapper (typed tool calls)
├── animationService.ts   # fal.ai Kling Pro image-to-video
├── visionService.ts      # OpenRouter vision → animation prompt
├── conversationState.ts  # Persistent JSON state across restarts
├── ipfsUtils.ts          # IPFS URL parsing and image validation
└── types.ts              # Shared TypeScript types
```

---

## Conversation Flow

```
User sends any message
  └─► Bot greets, explains /animate command

User sends /animate + 500 PFT
  └─► Payment confirmed, bot asks for IPFS link

User sends /uploadipfslink <ipfs-url>
  └─► Image validated
  └─► Vision LLM analyzes NFT → generates animation prompt
  └─► fal.ai Kling Pro generates 5-second video (~60–90s)
  └─► Video delivered as clickable link
```

---

## Security

- Private keys never leave your machine (handled by the PFT MCP server locally)
- OpenRouter and fal.ai are only called after payment is confirmed — `/uploadipfslink` cannot bypass `/animate`
- `.env` is gitignored and never committed

---

## License

MIT
