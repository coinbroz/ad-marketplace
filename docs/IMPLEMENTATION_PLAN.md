# Implementation Plan — 6 Days

**Start:** February 10, 2026
**Deadline:** February 16, 2026
**Current Status:** See `docs/PROGRESS_LOG.md` for detailed progress

---

## Day 1 — Foundation (Feb 10) — COMPLETED

### Goal: Backend skeleton + DB + Auth + Infrastructure

**Tasks:**
1. ~~`npm init` — инициализация проекта, установка зависимостей~~ DONE
   - fastify, @fastify/static, @fastify/cors, @fastify/jwt, @fastify/rate-limit
   - prisma, @prisma/client
   - grammy, @grammyjs/conversations
   - telegram (GramJS) — MTProto для channel stats
   - @ton/ton, @ton/crypto, @ton/core
   - bullmq, ioredis
   - dotenv, zod
   - typescript, tsx, vitest

2. Настройка TypeScript (`tsconfig.json`), ESM mode

3. Prisma schema — все модели из ARCHITECTURE.md:
   - User, Channel, ChannelManager, ChannelPrice, ChannelStats
   - Campaign, Deal, EscrowWallet, DealEvent
   - `npx prisma migrate dev`

4. `src/config.ts` — загрузка env переменных с валидацией (zod)
   - Все переменные: BOT_TOKEN, DATABASE_URL, REDIS_URL, TON_*, TELEGRAM_API_*, etc.

5. `src/index.ts` — запуск Fastify сервера
   - Rate limiting (@fastify/rate-limit)
   - CORS настройка
   - Health check: `GET /health`
   - Graceful shutdown (SIGTERM handler)
   - Pino logger с redact для секретов

6. `src/api/middleware/auth.ts` — валидация Telegram WebApp initData
   - Проверка HMAC-SHA256 подписи
   - Создание/обновление пользователя в БД
   - Выдача JWT токена

7. `src/bot/index.ts` — Grammy bot setup
   - Webhook endpoint `/webhook`
   - Команда `/start` — приветствие + кнопка Mini App
   - Команда `/help`
   - Handler `edited_channel_post` — для проверки редактирования постов

8. GramJS MTProto setup
   - `src/services/mtproto.ts` — TelegramClient с StringSession
   - Подключение к Telegram MTProto
   - Базовый тест: получить информацию о канале

9. Тестирование: бот отвечает на /start, auth endpoint работает, health check OK

**Результат дня:** Сервер запущен, бот работает, авторизация работает, MTProto подключён. DONE

---

## Day 2 — Marketplace Logic (Feb 11) — COMPLETED

### Goal: Channels + Campaigns + Stats + Filters + Admin checks

**Tasks:**
1. `src/services/channels.ts` — бизнес-логика каналов
   - Добавление канала (по username)
   - Проверка что бот — админ (`getChatMember`)
   - Получение подписчиков (`getChatMemberCount`)
   - Установка цен на форматы рекламы
   - `getChatAdministrators` — получение списка админов для PR manager flow

2. `src/services/telegram.ts` — Bot API статистика
   - Subscriber count
   - Chat info (title, description, username)

3. `src/services/mtproto.ts` — MTProto статистика (дополнить)
   - `getChannelStats(channelId)` — stats.getBroadcastStats
   - Парсинг: viewsPerPost, sharesPerPost, reactionsPerPost, graphs
   - Кэш в Redis (TTL 1 час)
   - Fallback на Bot API если MTProto недоступен

4. `src/api/middleware/verify-admin.ts` — re-check admin status
   - Fastify preHandler hook
   - getChatMember проверка
   - Redis кэш (TTL 5 мин)

5. `src/api/routes/channels.ts` — REST endpoints
   - GET /api/channels (список + детальные фильтры: subscribers, price, views, language, search, sort)
   - GET /api/channels/:id
   - POST /api/channels
   - PUT /api/channels/:id
   - GET /api/channels/:id/stats
   - GET /api/channels/:id/stats/full (MTProto)
   - POST /api/channels/:id/verify
   - GET /api/channels/:id/admins
   - POST /api/channels/:id/managers
   - DELETE /api/channels/:id/managers/:userId

6. `src/services/campaigns.ts` — бизнес-логика кампаний
   - Создание кампании/брифа
   - Фильтрация по бюджету, языку, подписчикам

7. `src/api/routes/campaigns.ts` — REST endpoints
   - GET /api/campaigns (список + фильтры: budget, language, search, sort)
   - POST /api/campaigns
   - PUT /api/campaigns/:id
   - POST /api/campaigns/:id/apply — **владелец канала откликается**

8. Bot conversations:
   - `/addchannel` — диалог: @username → verify → цены → язык → менеджеры
   - Уведомления о новых кампаниях/предложениях

**Результат дня:** Каналы + кампании + статистика + фильтры + PR manager flow + admin re-check. DONE

---

## Day 3 — TON Escrow (Feb 12) — 80% DONE (transactions TODO)

### Goal: Escrow wallets + payment monitoring + payouts + security
### REMAINING: releaseFunds() and refundFunds() actual TON transactions are placeholders

**Tasks:**
1. `src/utils/ton-wallet.ts` — утилиты для TON
   - `generateEscrowWallet()` — keypair (не mnemonic)
   - `encryptSecretKey(key)` / `decryptSecretKey(encrypted)` — AES-256-GCM
   - `getWalletBalance(address)` — через toncenter
   - `sendTon(wallet, toAddress, amount)` — отправка TON
   - `deployWallet(wallet)` — deploy контракта кошелька

2. `src/services/ton.ts` — TON сервис
   - `createEscrowForDeal(dealId)` — создать EscrowWallet
   - `checkPayment(dealId)` — проверить поступление (с deduplication по lt)
   - `releaseFunds(dealId)` — hot wallet gas → deploy → payout → owner
   - `refundFunds(dealId)` — hot wallet gas → deploy → refund → advertiser
   - Edge cases: partial payment notification, overpayment handling

3. `src/services/deals.ts` — бизнес-логика сделок
   - Создание сделки (от обеих сторон, с initiatedBy)
   - State machine: Map<DealStatus, DealStatus[]>
   - Валидация переходов (reject invalid)
   - DealEvent logging при каждом переходе
   - Таймауты: expiresAt по статусу

4. `src/api/routes/deals.ts` — REST endpoints
   - POST /api/deals — создать (с admin re-check для owner)
   - PUT /accept, /reject, /cancel (с admin re-check)
   - GET /api/deals/:id/escrow — адрес, баланс, TX links
   - GET /api/deals/:id/events — timeline

5. `src/workers/payment-monitor.ts` — BullMQ worker
   - Repeatable: каждые 30 сек
   - Проверка всех AWAITING_PAYMENT сделок
   - Concurrency: 1, retry: 3 с backoff

6. `src/workers/deal-timeout.ts` — BullMQ worker
   - Repeatable: каждые 5 мин
   - Авто-отмена + рефанд

7. Platform fee architecture:
   - config.PLATFORM_FEE_PERCENT = 0 (MVP)
   - Логика расчёта в ton.ts

8. Тестирование на testnet:
   - Создать сделку → escrow → оплата → FUNDED
   - Payout и refund flows

**Результат дня:** Escrow wallet generation, AES-256-GCM, state machine, payment monitoring — DONE. Actual TON send — TODO.

---

## Day 4 — Creative Workflow + Auto-posting (Feb 13) — COMPLETED

### Goal: Approval loop + auto-post + verification + scheduled posting

**Tasks:**
1. Creative approval flow в `src/services/deals.ts`:
   - Submit creative (text + media file_id)
   - Review → approve / request-edit (с editComment)
   - Цикл правок
   - Schedule time

2. `src/bot/conversations/submitCreative.ts` — Grammy conversation
   - Бот: "Отправьте текст поста для сделки #X"
   - Owner: текст + фото/видео
   - Бот: "Вот превью:" (forward preview)
   - Owner: подтверждает
   - Сохранение в Deal: creativeText + creativeMediaFileId + creativeMediaType

3. `src/bot/conversations/schedulePost.ts` — Grammy conversation
   - После CREATIVE_APPROVED
   - Бот: "Когда опубликовать? Дата+время или 'Сейчас'"
   - BullMQ delayed job

4. `src/services/posting.ts` — авто-постинг
   - `publishPost(dealId)` — публикация через Bot API
   - Поддержка: sendMessage (текст), sendPhoto, sendVideo, sendDocument
   - Сохранение postMessageId
   - SHA-256 hash контента → postContentHash
   - Проверка: бот ещё админ (admin re-check)

5. `src/workers/post-verifier.ts` — BullMQ worker
   - Каждые 5 минут для POSTED сделок
   - forwardMessage check → удаление обнаружено?
   - Удалить forwarded message после проверки
   - 24h passed → VERIFIED → trigger payout
   - DealEvent logging

6. `edited_channel_post` handler в боте:
   - Найти Deal по channel + message_id
   - Сравнить hash → DealEvent(type: "post_edit")
   - Уведомить рекламодателя

7. Bot notifications для всего workflow:
   - Новая сделка / отклик → обеим сторонам
   - Оплата получена → обоим (с суммой)
   - Креатив → рекламодателю (с превью)
   - Одобрено/правки → owner (с комментарием)
   - Пост опубликован → обоим (со ссылкой)
   - Пост удалён/отредактирован → обоим
   - Выплата/рефанд → обоим (с TX hash)

8. Scheduled posting:
   - BullMQ delayed job: `queue.add('publish', {dealId}, {delay})`
   - Worker: publishPost() в назначенное время

**Результат дня:** Полный цикл: сделка → оплата → креатив через бота → одобрение → публикация → верификация → выплата. DONE

---

## Day 5 — Mini App Frontend (Feb 10-11) — 95% DONE

### Goal: React UI в Telegram Mini App
### NOTE: All pages implemented and tested. LanguageInput, format selection, campaign edit added. Tab bar redesigned.

**Dependencies:**
```
react, react-dom, react-router-dom
@telegram-apps/telegram-ui
@telegram-apps/sdk-react
@tanstack/react-query
qrcode.react
```

**Tasks:**
1. Инициализация web/ — Vite + React + TypeScript

2. `web/src/main.tsx` — Entry point
   - AppRoot из @telegram-apps/telegram-ui
   - QueryClientProvider (@tanstack/react-query)
   - Router
   - WebApp.ready() + WebApp.expand()

3. `web/src/components/AppShell.tsx` — Layout
   - Tabbar: Marketplace / My Deals / Profile
   - BackButton management
   - Safe area insets

4. `web/src/api/client.ts` — HTTP клиент
   - Fetch wrapper с JWT из Telegram initData
   - React Query hooks: useChannels, useCampaigns, useDeals, etc.

5. Страницы:
   - **MarketplacePage** — SegmentedControl: Channels / Campaigns
     - ChannelCard (Cell-based), CampaignCard
     - FilterModal (Slider, Chip, search)
   - **ChannelPage** — статистика, цены, MainButton "Propose Deal"
   - **CampaignPage** — бриф, бюджет, MainButton "Apply with Channel"
     - ChannelSelectModal
   - **DealsPage** — мои сделки, SegmentedControl: Active / Completed
   - **DealPage** — DealTimeline (Timeline component), escrow info
     - MainButton: контекстный (Pay / Approve / Submit Creative)
     - TX explorer links (TON explorer)
   - **PaymentPage** — QR код + адрес + deeplinks (Tonkeeper, TON Space)
     - Real-time polling статуса
   - **ProfilePage** — каналы, кампании, TON wallet

6. Telegram-нативные элементы:
   - MainButton на каждой странице где нужен CTA
   - BackButton (скрыт на tabs, показан на дочерних)
   - HapticFeedback на действиях
   - showConfirm() для подтверждений

7. Loading/Empty/Error states:
   - Skeleton для каждой страницы
   - Placeholder для пустых списков
   - Error + Retry

8. Сборка: `vite build` → `web/dist/` → Fastify static

**Результат дня:** Рабочий Mini App с фильтрами (bottom sheet overlay), channel stats, deal pages, LanguageInput autocomplete (26 языков + fuzzy), format selection для Propose Deal, Campaign edit mode, custom tab bar с safe-area-inset-bottom. Deployed to Railway. Tested with two Telegram accounts — deal creation + notifications work.

---

## Day 6 — Integration + Deploy + Submit (Feb 15) — IN PROGRESS

### Goal: Deploy, E2E testing, README, submission
### NOTE: Deploy done early. E2E testing + TON transactions + README polish remaining.

**Tasks:**
1. End-to-end тестирование:
   - Flow 1: Регистрация → добавление канала → рекламодатель предлагает сделку → escrow → креатив → публикация → выплата
   - Flow 2: Рекламодатель создаёт кампанию → владелец канала откликается → escrow → креатив → публикация → выплата
   - Рефанд и таймауты
   - Admin re-check (убрать бота из админов → проверить что операция блокируется)

2. Deploy на Railway:
   - Создать проект
   - PostgreSQL + Redis addons
   - Env переменные (все из config.ts)
   - GitHub repo → автодеплой
   - webhook URL для бота
   - Тест MTProto на Railway (session)

3. README.md:
   - Badges (TypeScript, Node.js, License)
   - Architecture diagram (Mermaid)
   - Quick start (3 команды)
   - Deploy guide (Railway пошагово)
   - Key decisions: custodial escrow, Fastify, GramJS для stats, Grammy
   - Known limitations:
     - Language charts: API не предоставляет, указывается вручную
     - Premium stats: приватная статистика, API не отдаёт
     - MTProto requires user session
   - Future thoughts: smart contract escrow, WebSocket stats, advanced analytics, dispute resolution, TON Connect
   - AI percentage: "~85% code by AI (Claude), architecture/review/testing by human"
   - Screenshots/GIFs Mini App

4. Финальные багфиксы + полировка

5. Submission:
   - GitHub repo (public)
   - Бот задеплоен и работает
   - README готов
   - Submission через contests_app_bot

**Результат дня:** Всё работает, задеплоено, submission отправлен.

---

## Priorities — What to Cut if Running Late

### Порядок реализации (от самого важного):
1. Core escrow flow (Day 3) — НИКОГДА не режем
2. Admin re-check middleware (Day 2, ~2h) — MUST в спеке
3. Campaign apply flow (Day 2, ~4h) — MUST, двусторонний маркетплейс
4. Channel stats MTProto (Day 2, ~6h) — закрывает 4 пункта спеки
5. Creative через бота (Day 4, ~3h) — требование спеки
6. Post verification (Day 4, ~3h) — escrow security
7. Scheduled posting (Day 4, ~2h) — спека: "at the agreed time"
8. Detailed filters (Day 2, ~2h) — UX
9. PR manager flow (Day 2, ~3h) — "Extra" в спеке
10. Unique features (Day 5-6, ~5h) — "product thinking"

### Режем снизу вверх:
- ~~Unique features~~ — минус за product thinking
- ~~PR manager flow~~ — "Extra"
- ~~Detailed filters~~ → простой search
- **Всё остальное обязательно**

**НИКОГДА не режем:**
- Escrow flow + state machine
- Creative approval workflow
- Bot notifications
- Оба flow маркетплейса (advertiser→channel + owner→campaign)
- Admin re-check

---

## Key Libraries Reference

```json
{
  "dependencies": {
    "fastify": "^5.x",
    "@fastify/static": "^8.x",
    "@fastify/cors": "^10.x",
    "@fastify/jwt": "^9.x",
    "@fastify/rate-limit": "^10.x",
    "@prisma/client": "^6.x",
    "grammy": "^1.x",
    "@grammyjs/conversations": "^2.x",
    "telegram": "^2.x",
    "@ton/ton": "^15.x",
    "@ton/crypto": "^3.x",
    "@ton/core": "^0.x",
    "bullmq": "^5.x",
    "ioredis": "^5.x",
    "zod": "^3.x",
    "dotenv": "^16.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "vitest": "^2.x",
    "@types/node": "^22.x",
    "prisma": "^6.x"
  }
}
```

## Environment Setup Checklist

Before starting Day 1:
- [x] Node.js 20+ installed
- [x] Create Telegram Bot via @BotFather → get BOT_TOKEN
- [x] Create test channel in Telegram
- [x] Add bot as admin to test channel
- [ ] Get TON testnet coins from https://t.me/testgiver_ton_bot
- [x] Get toncenter API key from https://toncenter.com
- [ ] Register app on https://my.telegram.org → get API_ID, API_HASH (MTProto optional)
- [ ] Generate GramJS session string (MTProto optional)
- [x] Railway account created
- [x] GitHub repo created

---

## Status Summary (Updated Feb 11, 2026 — Session 3)

### COMPLETED:
- Days 1-2: Backend, DB, Auth, Bot, Channels, Campaigns, Stats, Filters, Admin re-check
- Day 3 (partial): Escrow wallet generation, encryption, payment monitoring, state machine
- Day 4: Creative workflow, bot conversations, auto-posting, post verification, scheduled posting
- Day 5 (98%): All Mini App pages + LanguageInput + format selection + campaign edit + tab bar redesign
- Deploy: Railway with PostgreSQL + Redis, auto-deploy from GitHub
- E2E Testing: Both marketplace flows tested (Propose Deal + Campaign Apply), payment, cancellation, refund

### Session 3 additions (Feb 11, Night):
- Deal cancellation with auto-refund for funded deals
- Refund address collection flow (advertiser enters wallet + memo after cancel)
- Rescue stuck CANCELLED deals → REFUNDED transition
- refundFunds/releaseFunds: removed strict wallet check, added balance API fallback
- Post verification fix: copyMessage instead of forwardMessage
- Bot: setMyCommands, context-aware hints, creative media to advertiser
- Payment page E2E tested with real TON testnet (1 TON sent + received)

### Session 2 additions (Feb 11, Evening):
- Campaign page: all fields visible, edit mode for owner, status colors, application count
- LanguageInput component: 26 languages, fuzzy aliases (рус→Russian, eng→English, etc.)
- Global BigInt fix: `app.setReplySerializer()` in `src/index.ts`
- Tab bar: custom with icons (🏪🤝👤), safe-area-inset-bottom for iPhone
- Format selection: Post/Forward/Story selectable on Channel page
- Error hints: "Check My Deals tab" on duplicate deal error

### REMAINING (3 items):
1. **TON actual transactions** — `releaseFunds()` and `refundFunds()` in `src/services/ton.ts` (4-6h)
2. **Full happy path E2E** — creative → approve → post → 24h verify → payout (3-4h)
3. **Submission** — Screenshots + submit via @contests_app_bot (1-2h)

### See `docs/PROGRESS_LOG.md` for detailed status of every component.
