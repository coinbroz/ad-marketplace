# Progress Log — Ad Marketplace

## Current Status: Day 5-6 (Feb 10, 2026)

**Deployed:** https://ad-marketplace-production.up.railway.app
**Bot:** @channelescrow_bot
**Railway status:** SUCCESS (latest deploy)

---

## What's Done (Days 1-5)

### Backend — 100% Core Logic

| Component | Status | Notes |
|-----------|--------|-------|
| Fastify server + plugins | DONE | CORS, rate-limit, static, JWT |
| Prisma schema (10 models) | DONE | User, Channel, ChannelManager, ChannelPrice, ChannelStats, Campaign, Deal, EscrowWallet, DealEvent |
| Telegram auth (initData HMAC) | DONE | `src/api/middleware/auth.ts` |
| Health check `/health` | DONE | |
| Graceful shutdown | DONE | SIGTERM handler |
| Config + Zod validation | DONE | `src/config.ts` |

### Channels & Campaigns — 100%

| Feature | Status | Files |
|---------|--------|-------|
| Channel CRUD | DONE | `src/services/channels.ts`, `src/api/routes/channels.ts` |
| Channel stats (Bot API) | DONE | `src/services/telegram.ts` — subscribers, chat info |
| Channel stats (MTProto) | DONE | `src/services/mtproto.ts` — views, shares, reactions via GramJS |
| Channel prices (multi-format) | DONE | Post, Forward, Story — free format |
| Channel filters (search, subs, price, language, sort) | DONE | Parsed as numbers, case-insensitive language |
| Campaign CRUD | DONE | `src/services/campaigns.ts`, `src/api/routes/campaigns.ts` |
| Campaign filters | DONE | Budget, language, search |
| Campaign apply (channel owner → campaign) | DONE | `POST /api/campaigns/:id/apply` |
| Admin re-check middleware | DONE | `src/api/middleware/verify-admin.ts` — Redis 5min cache |
| Channel managers (PR flow) | DONE | `POST/DELETE /api/channels/:id/managers` |
| `getChatAdministrators` | DONE | `src/services/telegram.ts` |
| BigInt serialization | FIXED | `serializeChannel()` helper for telegramId |

### Deal Workflow — 100% Logic

| Feature | Status | Files |
|---------|--------|-------|
| Deal state machine | DONE | `src/services/deals.ts` — VALID_TRANSITIONS map |
| Create deal (advertiser → channel) | DONE | `POST /api/deals` |
| Create deal (owner → campaign) | DONE | `POST /api/campaigns/:id/apply` |
| Accept / Reject / Cancel | DONE | `PUT /api/deals/:id/{accept,reject,cancel}` |
| Submit creative | DONE | API + bot conversation (`submitCreative.ts`) |
| Approve / Request edit | DONE | With edit comments |
| Schedule posting | DONE | API + bot conversation (`schedulePost.ts`) |
| Deal events / timeline | DONE | `GET /api/deals/:id/events` |
| Deal expiration timeouts | DONE | Per-status timeouts in state machine |

### TON Escrow — 80%

| Feature | Status | Notes |
|---------|--------|-------|
| Wallet generation (per deal) | DONE | `src/utils/ton-wallet.ts` — WalletContractV4, random keypair |
| AES-256-GCM encryption | DONE | Secret keys encrypted, stored in EscrowWallet table |
| Payment monitoring worker | DONE | `src/workers/payment-monitor.ts` — checks balance every 30s |
| Balance check via toncenter | DONE | `getWalletBalance()` |
| Escrow info for Mini App | DONE | Address, balance, explorer links, TX hashes |
| Partial payment notification | DONE | Notifies both parties |
| **releaseFunds()** | **TODO** | Logic + calculations done, **actual TON transaction is placeholder** |
| **refundFunds()** | **TODO** | Logic + calculations done, **actual TON transaction is placeholder** |
| **Hot wallet → escrow gas** | **TODO** | Deploy + gas fee transfer not implemented |

### Auto-Posting & Verification — 100%

| Feature | Status | Files |
|---------|--------|-------|
| Publish post (Bot API) | DONE | `src/services/posting.ts` — photo, video, document, text |
| Content hash (SHA-256) | DONE | Stored in Deal.postContentHash |
| Post deletion check | DONE | `src/workers/post-verifier.ts` — forwardMessage check |
| Post edit detection | DONE | `edited_channel_post` handler in bot |
| 24h verification → payout | DONE | Worker triggers releaseFunds after 24h |
| Scheduled publisher worker | DONE | `src/workers/scheduled-publisher.ts` |

### Bot — 100%

| Command | Status | Notes |
|---------|--------|-------|
| `/start` | DONE | Welcome + Mini App button |
| `/help` | DONE | Command list |
| `/mydeals` | DONE | Active deals list |
| `/addchannel` | DONE | With optional language arg |
| `/mycampaigns` | DONE | Campaign list |
| `/submitcreative` | DONE | Grammy conversation — text + media |
| `/schedulepost` | DONE | Grammy conversation — now or datetime |
| Notifications | DONE | All deal events notify both parties |

### Mini App (React) — 90%

| Page | Status | Notes |
|------|--------|-------|
| Marketplace (channels tab) | DONE | Search, filters as bottom sheet overlay, filter chips, channel cards |
| Marketplace (campaigns tab) | DONE | Search, filters, campaign cards, "+ Create Campaign" |
| Channel detail | DONE | Stats, prices, language edit, verify bot, propose deal |
| Campaign detail | DONE | Brief, budget, "Apply with Channel" |
| Create Campaign | DONE | Form: title, description, budget, language, min subs |
| Deal detail | DONE | Status, actions, escrow info, events timeline, polling |
| Deals list | DONE | Active/Completed filter, color-coded statuses |
| Profile | DONE | Info, wallet, channels (clickable), campaigns, add channel with language |
| **Payment page** | EXISTS | `web/src/pages/Payment.tsx` — needs testing |
| App Shell (tabs) | DONE | Marketplace / My Deals / Profile |
| Auth flow | DONE | Telegram initData → JWT → auto-refresh |

### Deploy — 100%

| Item | Status |
|------|--------|
| Railway project | DONE |
| PostgreSQL addon | DONE |
| Redis addon | DONE |
| GitHub auto-deploy | DONE |
| Webhook URL configured | DONE |
| Env variables set | DONE |
| Dockerfile | DONE |
| Domain | ad-marketplace-production.up.railway.app |

---

## What's NOT Done (3 Critical Items)

### 1. TON Actual Transactions (releaseFunds / refundFunds)
**File:** `src/services/ton.ts`, lines ~131 and ~211
**Problem:** The functions have all the business logic (calculate amounts, decrypt keys, platform fee, gas reserve) but the actual TON blockchain transaction is a **TODO placeholder**. No real TON is sent.
**What's needed:**
- Hot wallet sends ~0.05 TON gas to escrow address
- Deploy escrow wallet contract on-chain
- Sign and send transfer from escrow → owner (payout) or escrow → advertiser (refund)
- Record real TX hash
**Estimate:** ~4-6 hours
**Priority:** HIGH — escrow is the core feature

### 2. Payment Page Testing
**File:** `web/src/pages/Payment.tsx`
**Problem:** Page exists but hasn't been tested end-to-end with real TON testnet payments
**What's needed:**
- Test the full flow: create deal → get escrow address → send testnet TON → verify FUNDED status
- QR code generation for payment
- Deeplinks for Tonkeeper / TON Space
**Estimate:** ~2 hours (testing + fixes)
**Priority:** HIGH

### 3. End-to-End Testing with Two Accounts
**Problem:** Most testing done with single account (channel owner). Need second Telegram account to test:
- Advertiser proposes deal → owner accepts
- Owner applies to campaign → advertiser accepts
- Full creative approval loop between two users
- Bot notifications to both parties
**Estimate:** ~3 hours
**Priority:** HIGH — required before submission

---

## Bugs Fixed Today (Feb 10)

1. **BigInt serialization** — `PUT /api/channels/:id` returned raw Prisma with BigInt telegramId → "Internal Server Error". Fixed by using `getChannelById()` which serializes.

2. **Filter query params** — URL params are strings, Prisma needs numbers. Added `Number()` parsing in `listChannels()` and `listCampaigns()`.

3. **TypeScript build error** — `ChannelFilters.sortBy` type didn't include `"price_asc"` | `"price_desc"`. Added to union type.

4. **Filters UX** — Inline filters pushed results off screen. Redesigned as bottom sheet overlay with active filter chips.

---

## What We Tested Today

- [x] Channel page: prices set (Post 5, Forward 2, Story 1 TON)
- [x] Channel page: language editing (save + display)
- [x] Channel page: verified stats display
- [x] Marketplace: search works
- [x] Marketplace: filters work (subscribers, price, language, sort)
- [x] Marketplace: filter chips show active filters
- [x] Profile: channels list clickable
- [x] Profile: add channel with language
- [x] Deploy: Railway auto-deploy from GitHub push
- [ ] Campaign creation (UI exists, not tested)
- [ ] Deal creation (Propose Deal button visible for non-owners)
- [ ] Deal workflow (accept → payment → creative → post → verify)
- [ ] Payment flow (TON testnet)
- [ ] Bot notifications (two-way)
- [ ] Second account testing

---

## Tomorrow's Plan (Feb 11)

### Priority 1: TON Transactions (4-6h)
Implement actual TON sending in `releaseFunds()` and `refundFunds()`:
1. Hot wallet gas transfer to escrow
2. Deploy escrow wallet contract
3. Sign + send transfer (escrow → target)
4. Test on testnet

### Priority 2: End-to-End Testing (3h)
With two Telegram accounts:
1. Flow 1: Advertiser → Channel (propose deal → accept → pay → creative → post → verify → payout)
2. Flow 2: Owner → Campaign (apply → accept → pay → creative → post → verify → payout)
3. Refund/timeout flow
4. Bot notification verification

### Priority 3: UI Polish (2h)
- Test Payment page (QR + deeplinks)
- Test Campaign creation flow
- Fix any bugs found during E2E testing
- Loading/error states

### Priority 4: README + Submission (2h)
- Screenshots/GIFs
- Final README polish
- Known limitations update
- Submit via @contests_app_bot

---

## Railway Details (for quick reference)

```
Project ID:     3a070d36-6122-47f7-a61c-383ce6574812
Environment ID: 4ac135f5-bd8e-481a-90cb-f873b1da60e5
Service ID:     988e3fdd-8264-48a8-9bbe-8d11509152f9
Domain:         ad-marketplace-production.up.railway.app
Railway Token:  cfa1ee6f-2ed7-476e-8afd-4bb496af42f0
Bot:            @channelescrow_bot
Bot Token:      8340665648:AAHKR4UTgekKeW0OarwA_QmWuTWad4cU3Mk
```

---

## File Map (key files for next agent)

```
# Entry point
src/index.ts                          — Fastify server + plugins + workers start

# TON (NEEDS WORK)
src/services/ton.ts                   — releaseFunds() and refundFunds() have TODO
src/utils/ton-wallet.ts               — Wallet generation, encryption (DONE)

# Deal workflow (all DONE)
src/services/deals.ts                 — State machine, all transitions
src/services/posting.ts               — Auto-publish + hash
src/services/channels.ts              — Channel CRUD + filters
src/services/campaigns.ts             — Campaign CRUD + filters
src/services/telegram.ts              — Bot API helpers
src/services/mtproto.ts               — GramJS channel stats

# API routes (all DONE)
src/api/routes/deals.ts               — All deal endpoints
src/api/routes/channels.ts            — All channel endpoints
src/api/routes/campaigns.ts           — All campaign endpoints + apply
src/api/middleware/auth.ts             — Telegram auth
src/api/middleware/verify-admin.ts     — Admin re-check

# Bot (all DONE)
src/bot/index.ts                      — Commands + handlers
src/bot/conversations/submitCreative.ts
src/bot/conversations/schedulePost.ts

# Workers (all DONE)
src/workers/payment-monitor.ts
src/workers/post-verifier.ts
src/workers/deal-timeout.ts
src/workers/scheduled-publisher.ts

# Frontend (all DONE, needs testing)
web/src/pages/Marketplace.tsx         — Filter overlay + chips
web/src/pages/Channel.tsx             — Stats + owner management
web/src/pages/Campaign.tsx            — Detail + apply
web/src/pages/CreateCampaign.tsx      — Create form
web/src/pages/Deal.tsx                — Detail + actions + escrow
web/src/pages/Deals.tsx               — List + filter
web/src/pages/Payment.tsx             — QR + address
web/src/pages/Profile.tsx             — User info + channels + campaigns
web/src/api/client.ts                 — All API functions
web/src/App.tsx                       — Routes + auth
```
