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
- Auto-refund on timeout/cancellation
- Private keys encrypted with AES-256-GCM

### Creative Approval Workflow
```
Advertiser submits brief
  → Channel owner accepts deal
  → Advertiser pays to escrow
  → Owner drafts post (via bot conversation)
  → Advertiser approves or requests edits
  → Post auto-published at agreed time
  → 24h verification → funds released
```

### Channel Stats
- Subscriber count (Bot API)
- Average views, shares, reactions (MTProto via GramJS)
- Language (manually set by owner)
- Stats snapshots for history

### Post Verification
- **Deletion detection**: `forwardMessage` check every 5 minutes
- **Edit detection**: `edited_channel_post` webhook with content hash comparison
- **24h hold**: Funds released only after post stays intact for 24 hours

### Admin Re-check
Per spec requirement: admin status is re-verified via `getChatMember` before all financial operations (deal acceptance, creative submission, payouts). Cached in Redis (5 min TTL).

### PR Manager Flow
Channel owners can add managers who can accept deals and submit creatives, but cannot modify pricing or delete channels.

### Bot Commands
- `/start` — Open marketplace Mini App
- `/mydeals` — View active deals with status
- `/submitcreative` — Submit ad creative (conversation)
- `/schedulepost` — Schedule or publish approved post
- `/addchannel` — Add channel to marketplace
- `/help` — Available commands

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

1. **Custodial escrow** — New wallet per deal with encrypted keys. Simpler than smart contracts for MVP, provides full control over funds flow.

2. **Fastify over Express** — Better TypeScript support, faster, built-in schema validation, native async/await.

3. **GramJS for stats** — Bot API doesn't expose channel view counts. MTProto `stats.getBroadcastStats` provides views, shares, reactions data.

4. **Grammy for bot** — Modern, TypeScript-first, excellent conversations plugin for multi-step dialogs.

5. **Monolith architecture** — Single deployable unit on Railway. Simpler to deploy and debug. Workers run in the same process via BullMQ.

6. **Deal state machine** — Explicit valid transitions prevent invalid states. Every transition logged in DealEvent for full audit trail.

## Known Limitations

1. **Language distribution** — Not available through any Telegram API (private admin-only stat). Solution: channel owner sets language manually.

2. **Premium subscriber percentage** — Private statistic, not exposed via API. Noted in UI.

3. **MTProto session** — Requires a user session (phone number auth) for `stats.getBroadcastStats`. The bot token alone cannot access channel statistics.

4. **TON transactions** — Current implementation uses toncenter API for balance checks. Full transaction signing (deploy + send) is architectured but marked as TODO for actual wallet deployment on testnet.

5. **No dispute resolution UI** — Disputes are logged but manual resolution is needed. Future: voting/mediation system.

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
│   │   ├── index.ts          # Grammy setup + commands
│   │   └── conversations/    # submitCreative, schedulePost
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
