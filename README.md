# Ad Marketplace — Telegram Mini App

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-black.svg)](https://fastify.dev/)
[![Grammy](https://img.shields.io/badge/Grammy-1.x-blue.svg)](https://grammy.dev/)
[![TON](https://img.shields.io/badge/TON-Testnet-0088CC.svg)](https://ton.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An MVP marketplace connecting Telegram channel owners with advertisers. Features escrow-style deals on TON blockchain, creative approval workflows, auto-posting, and post verification.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Railway                             │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Node.js Server (Fastify)             │   │
│  │                                                    │   │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────────────┐  │   │
│  │  │ REST API │  │ Bot Hook │  │ Static (React)  │  │   │
│  │  │ /api/*   │  │ /webhook │  │ /*              │  │   │
│  │  └────┬─────┘  └────┬─────┘  └─────────────────┘  │   │
│  │       │              │                              │   │
│  │  ┌────┴──────────────┴──────────────────────────┐  │   │
│  │  │              Services Layer                    │  │   │
│  │  │  channels | deals | ton | posting | telegram  │  │   │
│  │  │  mtproto (GramJS)                             │  │   │
│  │  └────┬──────────────┬──────────────────────────┘  │   │
│  │       │              │                              │   │
│  │  ┌────┴─────┐  ┌────┴──────┐                      │   │
│  │  │ Prisma   │  │ BullMQ    │                      │   │
│  │  │ (PgSQL)  │  │ (Workers) │                      │   │
│  │  └────┬─────┘  └────┬──────┘                      │   │
│  └───────┼──────────────┼────────────────────────────┘   │
│          │              │                                 │
│  ┌───────┴─────┐  ┌────┴──────┐                         │
│  │ PostgreSQL  │  │   Redis   │                         │
│  └─────────────┘  └───────────┘                         │
└─────────────────────────────────────────────────────────┘
          │                    │
          ▼                    ▼
   ┌──────────────┐    ┌──────────────┐
   │ Telegram API │    │  TON Network │
   │ Bot + MTProto│    │  (toncenter) │
   └──────────────┘    └──────────────┘
```

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> && cd ad-marketplace
npm install
cd web && npm install --legacy-peer-deps && cd ..

# 2. Setup database
cp .env.example .env  # Fill in your values
npx prisma migrate dev

# 3. Run
npm run dev
```

## Deploy to Railway

1. Create a new project on [Railway](https://railway.app)
2. Add **PostgreSQL** and **Redis** plugins
3. Connect your GitHub repository
4. Set environment variables (see `.env.example`)
5. Railway auto-deploys on push to `main`

Key env variables:
```
BOT_TOKEN=              # From @BotFather
WEBAPP_URL=             # Your Railway URL
DATABASE_URL=           # Auto-set by Railway PostgreSQL
REDIS_URL=              # Auto-set by Railway Redis
ESCROW_ENCRYPTION_KEY=  # Random 32+ char string
HOT_WALLET_MNEMONIC=    # TON wallet mnemonic
TON_API_KEY=            # From toncenter.com
```

## Features

### Two-Sided Marketplace
- **Channel owners** list their channels with pricing for ad formats
- **Advertisers** create campaign briefs with budget and requirements
- Both sides can initiate deals — converging into a single workflow

### Escrow on TON
- Unique wallet generated per deal (custodial)
- Payment monitoring (30s intervals)
- Auto-release after 24h verification
- Auto-refund on cancellation (any post-payment status)
- Refund address collection: advertiser enters wallet + optional memo after cancellation
- Exchange-safe refunds: memo field for users who paid from exchange
- Rescue mechanism: stuck CANCELLED deals can be refunded retroactively
- Private keys encrypted with AES-256-GCM

### Creative Approval Workflow
```
Deal accepted
  → Advertiser pays to escrow
  → Advertiser submits brief + materials (via /submitbrief)
  → Channel owner creates ad post (via /submitcreative)
  → Advertiser reviews: approves or requests edits (Mini App)
  → Once approved, post auto-published at agreed time (via /schedulepost)
  → 24h verification → funds released to channel owner
```

### Cancellation & Refund
```
Either party cancels (from any status before POSTED)
  → If deal was funded: auto-refund triggered
  → Advertiser receives notification to enter refund wallet address
  → Refund address + optional memo (for exchange users) saved via Mini App
  → Funds returned to specified address
```

### Channel Stats
- Subscriber count (Bot API)
- Average views, shares, reactions (MTProto via GramJS)
- Language (manually set by owner)
- Stats snapshots for history

### Post Verification
- **Deletion detection**: `copyMessage` check every 5 minutes (copy to same channel, immediately deleted)
- **Edit detection**: `edited_channel_post` webhook with SHA-256 content hash comparison
- **24h hold**: Funds released only after post stays intact for 24 hours
- **Dispute**: If post deleted before 24h → deal moves to DISPUTED, funds frozen

### Admin Re-check
Per spec requirement: admin status is re-verified via `getChatMember` before all financial operations (deal acceptance, creative submission, payouts). Cached in Redis (5 min TTL).

### PR Manager Flow
Channel owners can add managers who can accept deals and submit creatives, but cannot modify pricing or delete channels.

### Bot Commands
| Command | Description |
|---------|-------------|
| `/start` | Open marketplace Mini App |
| `/mydeals` | View active deals with status |
| `/addchannel` | Add channel to marketplace |
| `/mycampaigns` | View your campaigns |
| `/submitbrief` | Submit ad brief + materials (advertiser) |
| `/submitcreative` | Create ad post for review (channel owner) |
| `/schedulepost` | Schedule or publish approved post |
| `/help` | Show all commands |

### Background Workers (BullMQ)
| Worker | Interval | Task |
|--------|----------|------|
| payment-monitor | 30s | Check escrow balances for AWAITING_PAYMENT deals |
| post-verifier | 5min | Verify posts aren't deleted, trigger payout at 24h |
| deal-timeout | 5min | Auto-cancel/refund expired deals |
| scheduled-publisher | On schedule | Publish posts at scheduled time |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20 |
| Backend | Fastify 5 |
| Frontend | React 18 + Vite |
| UI Kit | @telegram-apps/telegram-ui |
| Database | PostgreSQL (Prisma ORM) |
| Cache/Queues | Redis (BullMQ) |
| Bot | Grammy + Conversations |
| Channel Stats | GramJS (MTProto) |
| TON | @ton/ton, @ton/crypto |
| Deploy | Railway (Docker) |

## Key Decisions

1. **Custodial escrow** — New V4 wallet per deal with AES-256-GCM encrypted keys. Simpler than smart contracts for MVP, provides full control over funds flow. Each wallet is a separate Prisma `EscrowWallet` record.

2. **Fastify over Express** — Better TypeScript support, faster, built-in schema validation, native async/await. Global BigInt serializer for Prisma compatibility.

3. **GramJS for stats** — Bot API doesn't expose channel view counts. MTProto `stats.getBroadcastStats` provides views, shares, reactions data. Fallback to Bot API if MTProto unavailable.

4. **Grammy for bot** — Modern, TypeScript-first, excellent conversations plugin for multi-step dialogs (submitBrief, submitCreative, schedulePost).

5. **Monolith architecture** — Single deployable unit on Railway. Simpler to deploy and debug. Workers run in the same process via BullMQ.

6. **Deal state machine** — 14 states with explicit valid transitions. Every transition logged in `DealEvent` for full audit trail. Auto-timeout for stalled deals. Cancellation from any post-payment state triggers auto-refund. Stuck CANCELLED deals can be rescued via refund address submission.

7. **Two-way marketplace** — Both entry points from spec: channel owners list channels (advertisers propose deals), advertisers create campaigns (owners apply). Both converge into the same deal workflow.

8. **Bot-driven creative flow** — Per spec: "For messaging, use a text bot; don't create a chat in a mini-app". Brief submission, creative creation, and scheduling all happen via bot conversations. Mini App is for browsing, deal management, and approvals.

## Known Limitations

1. **Language distribution** — Not available through any Telegram API (private admin-only stat). Solution: channel owner sets language manually.

2. **Premium subscriber percentage** — Private statistic, not exposed via API. Noted in UI.

3. **MTProto session** — Requires a user session (phone number auth) for `stats.getBroadcastStats`. The bot token alone cannot access channel statistics.

4. **TON transactions** — Payment monitoring and balance checks work via toncenter API. Payout/refund transaction signing (deploy + send from escrow) is architectured but uses placeholder tx hashes. The escrow wallet keys are generated and encrypted — ready for full on-chain implementation.

5. **No dispute resolution UI** — Disputes are detected and logged (post deletion/edit), but manual resolution is needed. Future: voting/mediation system.

6. **Gas reserve** — 0.05 TON is reserved per deal for on-chain gas fees (escrow wallet deploy + transfer). This means channel owner receives `price - 0.05 TON`.

## Future Thoughts

- **Smart contract escrow** — Replace custodial approach with TON smart contracts for trustless operation
- **TON Connect** — Native wallet connection instead of manual address input
- **WebSocket real-time** — Live deal status updates instead of polling
- **Advanced analytics** — Channel reputation scores, completion rates, response times
- **Multi-format support** — Stories, forwards with different pricing and verification
- **Dispute resolution** — Automated mediation with evidence submission
- **Platform fee** — Architecture ready (`PLATFORM_FEE_PERCENT` config), set to 0% for MVP

## Project Structure

```
├── src/
│   ├── index.ts              # Entry point (Fastify + plugins + workers)
│   ├── config.ts             # Env validation (Zod)
│   ├── lib/                  # Prisma & Redis clients
│   ├── api/
│   │   ├── routes/           # channels, campaigns, deals, auth
│   │   └── middleware/       # auth (JWT), verify-admin
│   ├── bot/
│   │   ├── index.ts          # Grammy setup + commands + setMyCommands
│   │   └── conversations/    # submitBrief, submitCreative, schedulePost
│   ├── services/             # Business logic
│   │   ├── channels.ts       # Channel CRUD + stats
│   │   ├── campaigns.ts      # Campaign CRUD + filters
│   │   ├── deals.ts          # State machine + transitions
│   │   ├── ton.ts            # Escrow + payments
│   │   ├── posting.ts        # Auto-publish + hash
│   │   ├── telegram.ts       # Bot API helpers
│   │   └── mtproto.ts        # GramJS stats
│   ├── workers/              # BullMQ background jobs
│   └── utils/                # TON wallet, Telegram auth
├── web/                      # React Mini App
│   └── src/
│       ├── pages/            # Marketplace, Channel, Campaign, Deal, Payment, Profile
│       ├── api/client.ts     # HTTP client + React Query hooks
│       └── types.ts          # Shared TypeScript interfaces
├── prisma/schema.prisma      # Database schema (10 models)
├── Dockerfile
└── docs/                     # Architecture, Implementation Plan, Contest Spec
```

## AI Code Percentage

~85% of the code was written by AI (Claude), with human direction for architecture, requirements analysis, and review.

## License

MIT
