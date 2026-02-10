# Ad Marketplace Contest — Full Specification

## Overview
- **Reward:** $15,000+ $BUILD grant to make the product prod-ready
- **Deadline:** February 16, 2026
- **Entry Fee:** 1 TON

Build an MVP Telegram Mini App for an ads marketplace that connects channel owners and advertisers, using an escrow-style deal flow.

## Requirements

### 1. Marketplace Model (both sides must be supported)

**Channel Owner Listings:**
- Channel owner lists their channel, sets pricing, and adds a bot as an admin (for stats verification and future auto-posting)
- Extra: think about PR manager flow and ability to add 1+ users to manage channel, for example fetch admins of the channel with selected rights
- Must re-check if user still an admin on financial and other important operations

**Advertiser Requests:**
- Advertiser creates a request/campaign brief; channel owners (influencers) can apply

**Key Points:**
- Both entry points must converge into a single unified workflow for negotiation, approvals, escrow, and auto-posting
- For messaging, use a text bot; don't create a chat in a mini-app
- Implement practical filters for both offer types (pricing, subscribers, views, etc.)

### 2. Verified Channel Stats (from Telegram)
Automatically fetch and display verified channel stats available via Telegram, including (at minimum):
- Subscribers
- Average views / reach
- Language charts
- Telegram Premium stats
- Any other metrics exposed by Telegram channel analytics

### 3. Ad Formats and Pricing
- Support setting prices for different ad formats within a single channel
- Examples: post, forward/repost, story, and other formats
- Only post is OK for MVP
- This should be a free format rather than a strict ad type

### 4. Escrow Deal Flow Based on TON
Implement an escrow-style flow:
```
Payment by advertiser → Funds held by us → Auto-posting confirms delivery → Release or refund
```

**Security:**
- Recommended to use a new address/wallet for each deal or for each user, except for a hot wallet

**Lifecycle Controls:**
- Auto-cancel / timeout if the deal stalls (no activity for X time)
- Clear deal statuses and transitions

### 5. Creative Approval Workflow
A clear approval loop must exist:
```
Advertiser submits preferences / brief
  → Channel owner accepts or rejects
  → If accepted, channel owner drafts the post and submits it for review
  → Advertiser approves or requests edits
  → Once approved, the post is auto-published at the agreed time
```

### 6. Auto-posting
- Auto-post the approved creative to the channel
- Verify it's not deleted, edited, etc.
- Verify that creative is done and stays in channel for enough time before releasing funds to channel owner

## Tech Stack
> We do not restrict the tech stack. We want to see your product thinking, engineering decisions, and system design. Your code should be clean and ready to opensource.
> Backend is the main focus. If you're short on frontend capacity, a lightweight UI is acceptable, prioritize working flows over visual polish.

## Prize
The grant is a paid build budget. The winner will receive milestone-based compensation to continue development while they remain the product owner and handle everything except engineering; rev-share is negotiable.

## Submission Requirements
1. **GitHub repo + README** (run/deploy instructions)
2. **Demo:** a test bot deployed on Telegram
3. **Short written project overview:**
   - Architecture
   - Key decisions
   - Future thoughts
   - Known limitations
   - Specify percentage of code written by AI

## Community
- Ask questions in @tools_community
- Contest App: https://t.me/contests_app_bot/app?startapp=contest-29374b12297f030ed6003296c95e37c7
