# Architecture — Ad Marketplace

## System Overview

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
│  │  │ (DB)     │  │ (Workers) │                      │   │
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

## Database Schema (Prisma)

### Users
```prisma
model User {
  id              Int       @id @default(autoincrement())
  telegramId      BigInt    @unique
  username        String?
  firstName       String
  lastName        String?
  role            Role      @default(BOTH)
  tonWalletAddress String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  channels          Channel[]
  managedChannels   ChannelManager[]
  campaigns         Campaign[]
  dealsAsAdvertiser Deal[]   @relation("advertiser")
  dealsAsOwner      Deal[]   @relation("channelOwner")
}

enum Role {
  ADVERTISER
  CHANNEL_OWNER
  BOTH
}
```

### Channels
```prisma
model Channel {
  id              Int       @id @default(autoincrement())
  telegramId      BigInt    @unique
  username        String?
  title           String
  description     String?
  subscriberCount Int       @default(0)
  avgViewCount    Int       @default(0)
  language        String?
  premiumPercent  Float?
  botIsAdmin      Boolean   @default(false)
  isActive        Boolean   @default(true)
  ownerId         Int
  owner           User      @relation(fields: [ownerId], references: [id])
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  prices          ChannelPrice[]
  managers        ChannelManager[]
  deals           Deal[]
  stats           ChannelStats[]
}
```

### Channel Managers (PR Manager Flow)
```prisma
model ChannelManager {
  id        Int      @id @default(autoincrement())
  channelId Int
  channel   Channel  @relation(fields: [channelId], references: [id])
  userId    Int
  user      User     @relation(fields: [userId], references: [id])
  role      String   @default("manager") // "owner", "manager"
  addedAt   DateTime @default(now())

  @@unique([channelId, userId])
}
```
Владелец канала может добавить других пользователей (менеджеров) для управления каналом. При добавлении канала автоматически вызывается `getChatAdministrators` для получения списка админов. Менеджеры могут: принимать сделки, отправлять креативы. Не могут: удалять канал, менять цены.

### Channel Prices
```prisma
model ChannelPrice {
  id          Int      @id @default(autoincrement())
  channelId   Int
  channel     Channel  @relation(fields: [channelId], references: [id])
  format      String   // "post", "forward", "story" — свободный формат
  priceInTon  Float
  description String?
  createdAt   DateTime @default(now())

  @@unique([channelId, format])
}
```

### Channel Stats (snapshots)
```prisma
model ChannelStats {
  id              Int      @id @default(autoincrement())
  channelId       Int
  channel         Channel  @relation(fields: [channelId], references: [id])
  subscriberCount Int
  avgViewCount    Int
  sharesPerPost   Float?
  reactionsPerPost Float?
  premiumPercent  Float?
  languageData    Json?    // { "ru": 45, "en": 30, ... }
  rawData         Json?    // Полные данные из stats.getBroadcastStats
  fetchedAt       DateTime @default(now())
}
```

### Campaigns (запросы рекламодателей)
```prisma
model Campaign {
  id              Int       @id @default(autoincrement())
  advertiserId    Int
  advertiser      User      @relation(fields: [advertiserId], references: [id])
  title           String
  description     String
  budgetPerPost   Float
  targetLanguage  String?
  minSubscribers  Int?
  minAvgViews     Int?
  status          CampaignStatus @default(ACTIVE)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  deals           Deal[]
}

enum CampaignStatus {
  ACTIVE
  PAUSED
  COMPLETED
  CANCELLED
}
```

### Deals (сделки)
```prisma
model Deal {
  id                Int       @id @default(autoincrement())
  channelId         Int
  channel           Channel   @relation(fields: [channelId], references: [id])
  campaignId        Int?
  campaign          Campaign? @relation(fields: [campaignId], references: [id])
  advertiserId      Int
  advertiser        User      @relation("advertiser", fields: [advertiserId], references: [id])
  channelOwnerId    Int
  channelOwner      User      @relation("channelOwner", fields: [channelOwnerId], references: [id])
  initiatedBy       String    @default("advertiser") // "advertiser" | "channel_owner"
  format            String    @default("post")
  priceInTon        Float
  status            DealStatus @default(PENDING)

  // Escrow (address stored here for quick access, keys in EscrowWallet)
  escrowAddress     String?

  // Payment
  paidAt            DateTime?
  paidTxHash        String?

  // Creative
  brief             String?
  creativeText      String?
  creativeMediaType String?   // "photo", "video", "document", null
  creativeMediaFileId String? // Telegram file_id
  creativeApproved  Boolean   @default(false)
  editComment       String?   // Комментарий при запросе правок

  // Posting
  scheduledAt       DateTime?
  postedAt          DateTime?
  postMessageId     Int?
  postContentHash   String?   // SHA-256 hash контента при публикации
  postVerifiedAt    DateTime?
  postDeletedAt     DateTime?
  postEditedAt      DateTime?

  // Payout
  payoutTxHash      String?
  paidOutAt         DateTime?
  refundTxHash      String?
  refundedAt        DateTime?

  // Timing
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  expiresAt         DateTime?

  escrowWallet      EscrowWallet?
  events            DealEvent[]
}

enum DealStatus {
  PENDING
  ACCEPTED
  AWAITING_PAYMENT
  FUNDED
  CREATIVE_DRAFT
  CREATIVE_REVIEW
  CREATIVE_APPROVED
  SCHEDULED
  POSTED
  VERIFIED
  COMPLETED
  REFUNDED
  CANCELLED
  DISPUTED
  EXPIRED
}
```

### Escrow Wallet (отдельная таблица для безопасности ключей)
```prisma
model EscrowWallet {
  id           Int    @id @default(autoincrement())
  dealId       Int    @unique
  deal         Deal   @relation(fields: [dealId], references: [id])
  address      String
  publicKey    String
  secretKeyEnc String // AES-256-GCM encrypted
  secretKeyIv  String // Initialization vector
  secretKeyTag String // GCM auth tag
  createdAt    DateTime @default(now())
}
```
Приватные ключи escrow-кошельков хранятся ТОЛЬКО в этой таблице. Доступ к ним — только из `src/services/ton.ts`. Никогда не возвращать в API-ответах.

### Deal Events (лог событий)
```prisma
model DealEvent {
  id        Int       @id @default(autoincrement())
  dealId    Int
  deal      Deal      @relation(fields: [dealId], references: [id])
  type      String    // "status_change", "payment", "message", "post_edit", "post_delete"
  data      Json?
  createdAt DateTime  @default(now())
}
```

## Deal State Machine

Валидные переходы статусов. Любой другой переход — отклоняется.

```
PENDING         → [ACCEPTED, CANCELLED, EXPIRED]
ACCEPTED        → [AWAITING_PAYMENT, CANCELLED]
AWAITING_PAYMENT→ [FUNDED, CANCELLED, EXPIRED]
FUNDED          → [CREATIVE_DRAFT, CANCELLED, REFUNDED]
CREATIVE_DRAFT  → [CREATIVE_REVIEW, CANCELLED]
CREATIVE_REVIEW → [CREATIVE_APPROVED, CREATIVE_DRAFT, CANCELLED]
CREATIVE_APPROVED→[SCHEDULED, POSTED, CANCELLED]
SCHEDULED       → [POSTED, CANCELLED]
POSTED          → [VERIFIED, DISPUTED]
VERIFIED        → [COMPLETED]
COMPLETED       → [] (terminal)
REFUNDED        → [] (terminal)
CANCELLED       → [REFUNDED]  // refund for cancelled deals that had payment
DISPUTED        → [CANCELLED, REFUNDED, COMPLETED]
EXPIRED         → [] (terminal)
```

Таймауты для каждого статуса:
- All statuses → 24h (auto-cancel on inactivity)

## Two-Sided Marketplace Flow

### Flow 1: Рекламодатель → Канал
```
Рекламодатель просматривает каталог каналов (Mini App)
  → Выбирает канал, нажимает "Propose Deal"
  → Создаётся Deal (initiatedBy: "advertiser")
  → Бот уведомляет owner канала
  → Далее единый workflow
```

### Flow 2: Владелец канала → Кампания
```
Владелец канала просматривает кампании рекламодателей (Mini App)
  → Выбирает кампанию, нажимает "Apply with Channel"
  → Выбирает свой канал из списка
  → Создаётся Deal (initiatedBy: "channel_owner")
  → Бот уведомляет рекламодателя
  → Далее единый workflow
```

### Единый workflow (после создания Deal):
```
PENDING: ожидает принятия другой стороной
  → ACCEPTED: обе стороны согласны
  → AWAITING_PAYMENT: генерируется escrow wallet, рекламодатель получает адрес
  → FUNDED: оплата получена (worker подтвердил)
  → CREATIVE_DRAFT: owner готовит пост (через бота)
  → CREATIVE_REVIEW: рекламодатель проверяет
  → CREATIVE_APPROVED: одобрен
  → SCHEDULED / POSTED: авто-публикация
  → VERIFIED: пост проверен (24h без удаления)
  → COMPLETED: деньги выплачены owner-у
```

## Channel Stats Strategy

### Источники данных:

| Метрика | Источник | Метод |
|---------|----------|-------|
| Subscribers | Bot API | `getChatMemberCount` |
| Avg views per post | MTProto (GramJS) | `stats.getBroadcastStats` |
| Shares per post | MTProto (GramJS) | `stats.getBroadcastStats` |
| Reactions per post | MTProto (GramJS) | `stats.getBroadcastStats` |
| Growth graph | MTProto (GramJS) | `stats.getBroadcastStats` |
| Interactions graph | MTProto (GramJS) | `stats.getBroadcastStats` |
| Language | Ручной ввод owner | При добавлении канала |
| Premium % | N/A | API не предоставляет |

### Реализация:
1. `src/services/telegram.ts` — Bot API (subscribers, chat info)
2. `src/services/mtproto.ts` — GramJS (stats.getBroadcastStats)
3. Кэш в Redis: TTL 1 час
4. Снимки в `ChannelStats` для истории
5. Fallback: если MTProto недоступен → только subscribers

### Known Limitations:
- Language distribution доступна только администратору в приватной статистике Telegram, API не отдаёт. Решение: owner указывает язык вручную.
- Premium % недоступен через API. Описать в README.

## Admin Re-check Middleware

Спецификация: "Must re-check if user still an admin on financial and other important operations"

### Реализация: `src/api/middleware/verify-admin.ts`
- Fastify preHandler hook
- Вызывает `bot.api.getChatMember(channel.telegramId, user.telegramId)`
- Проверяет `status in ["creator", "administrator"]`
- Кэш в Redis: TTL 5 минут
- Применяется на endpoints:
  - `PUT /api/deals/:id/accept` (channel owner side)
  - `PUT /api/deals/:id/creative` (submit creative)
  - Payout-related internal calls
- Отдельно перед auto-post: проверить что бот ещё админ канала

## TON Escrow Flow — Detailed

### Wallet Generation
```
Для каждой сделки:
1. keyPairFromSeed(randomBytes(32)) → { publicKey, secretKey }
2. WalletContractV4.create({ publicKey }) → wallet
3. wallet.address → escrow address
4. Шифруем secretKey через AES-256-GCM → сохраняем в EscrowWallet
```

### Wallet Activation
Новый TON-кошелёк не может отправлять транзакции без deploy контракта. Стоимость: ~0.01 TON gas.
- При payout: hot wallet сначала отправляет ~0.05 TON на escrow для gas
- Затем escrow wallet делает deploy + send в одной транзакции
- Gas fee учитывается при расчёте: payout = balance - gas_reserve

### Payment Monitoring (BullMQ Worker)
```
Каждые 30 секунд для всех сделок со статусом AWAITING_PAYMENT:
1. Запрашиваем баланс escrow-адреса через toncenter API
2. Если баланс >= priceInTon:
   - Обновляем статус → FUNDED
   - Записываем paidAt, paidTxHash (по lt — logical time)
   - Уведомляем обоих через бота
3. Если expiresAt < now():
   - Статус → EXPIRED
   - Уведомляем
```

Edge cases:
- Partial payment (баланс < priceInTon): уведомить "Оплачено X из Y TON"
- Overpayment: принять, при payout вернуть разницу
- Multiple transactions: суммировать баланс, не отдельные транзакции
- Transaction deduplication: хранить lt последней обработанной транзакции

### Payout
```
Когда пост верифицирован (24 часа без удаления):
1. Проверить admin status (re-check middleware)
2. Hot wallet → escrow wallet (gas для deploy)
3. Расшифровываем secretKey из EscrowWallet
4. Deploy + send: escrow → channel owner wallet (amount - gas)
5. Записываем payoutTxHash, paidOutAt
6. Статус → COMPLETED
```

### Refund
```
При отмене/таймауте/споре:
1. Hot wallet → escrow wallet (gas)
2. Расшифровываем secretKey
3. Send: escrow → advertiser wallet (amount - gas)
4. Записываем refundTxHash, refundedAt
5. Статус → REFUNDED
```

### Platform Fee (архитектурно готово)
```
config.PLATFORM_FEE_PERCENT = 0  // 0% для MVP
При payout:
  ownerAmount = balance * (1 - PLATFORM_FEE_PERCENT / 100) - gas
  feeAmount = balance * (PLATFORM_FEE_PERCENT / 100)
  escrow → owner (ownerAmount)
  escrow → hot wallet (feeAmount)  // только если fee > 0
```

## Post Verification

### Проверка удаления:
Worker `post-verifier` каждые 5 минут для сделок со статусом POSTED:
```
bot.api.forwardMessage(BOT_PRIVATE_CHAT_ID, channelTelegramId, postMessageId)
  → Успех: пост на месте, удалить forwarded message
  → Ошибка "message not found": пост удалён
    → DealEvent(type: "post_delete")
    → Уведомить обоих
    → Заблокировать выплату
```

### Проверка редактирования:
Grammy webhook handler для `edited_channel_post`:
```
bot.on("edited_channel_post", (ctx) => {
  // Найти Deal по channel + message_id
  // Сравнить hash контента с Deal.postContentHash
  // Если изменён → DealEvent(type: "post_edit")
  // Уведомить рекламодателя
})
```

### При публикации:
Сохранять SHA-256 hash от `text + file_ids` в `Deal.postContentHash`.

### Time-based release:
Если 24 часа после postedAt прошли и пост не удалён/не отредактирован → статус VERIFIED → trigger payout.

## API Endpoints

### Auth
```
POST /api/auth/telegram    — Валидация Telegram WebApp initData, выдача JWT
```

### Health
```
GET  /health               — { status: "ok", timestamp }
```

### Channels
```
GET    /api/channels              — Список каналов (с фильтрами)
GET    /api/channels/:id          — Детали канала + статистика
POST   /api/channels              — Добавить канал (owner)
PUT    /api/channels/:id          — Обновить канал
DELETE /api/channels/:id          — Удалить канал
GET    /api/channels/:id/stats    — История статистики
GET    /api/channels/:id/stats/full — Полная статистика (MTProto)
POST   /api/channels/:id/verify   — Проверить что бот — админ
GET    /api/channels/:id/admins   — Получить админов канала из Telegram
POST   /api/channels/:id/managers — Добавить менеджера
DELETE /api/channels/:id/managers/:userId — Удалить менеджера
```

### Channel Filters (GET /api/channels query params):
```
minSubscribers, maxSubscribers  — диапазон подписчиков
minPrice, maxPrice              — диапазон цен (формат "post")
minAvgViews, maxAvgViews        — диапазон средних просмотров
language                        — язык канала
format                          — поддерживаемый формат рекламы
search                          — поиск по title/description
sortBy                          — subscribers | price | views | created
sortOrder                       — asc | desc
page, limit                     — пагинация
```

### Campaigns
```
GET    /api/campaigns             — Список кампаний (с фильтрами)
GET    /api/campaigns/:id         — Детали кампании
POST   /api/campaigns             — Создать кампанию (advertiser)
PUT    /api/campaigns/:id         — Обновить кампанию
DELETE /api/campaigns/:id         — Удалить кампанию
POST   /api/campaigns/:id/apply   — Откликнуться на кампанию (channel owner)
```

### Campaign Filters (GET /api/campaigns query params):
```
minBudget, maxBudget            — диапазон бюджета
language                        — целевой язык
status                          — active | paused
search                          — поиск по title/description
sortBy                          — budget | created
sortOrder                       — asc | desc
page, limit                     — пагинация
```

### Deals
```
GET    /api/deals                 — Мои сделки (обе стороны)
GET    /api/deals/:id             — Детали сделки
POST   /api/deals                 — Создать сделку (предложить канал)
PUT    /api/deals/:id/accept      — Принять сделку
PUT    /api/deals/:id/reject      — Отклонить
PUT    /api/deals/:id/creative    — Отправить креатив (также через бота)
PUT    /api/deals/:id/approve     — Одобрить креатив
PUT    /api/deals/:id/request-edit — Запросить правки (с комментарием)
PUT    /api/deals/:id/schedule    — Назначить время публикации
PUT    /api/deals/:id/cancel      — Отменить сделку
GET    /api/deals/:id/escrow      — Данные escrow (адрес, баланс, статус)
GET    /api/deals/:id/events      — Лог событий сделки (timeline)
```

### User
```
GET    /api/user/me               — Мой профиль
PUT    /api/user/me               — Обновить профиль
PUT    /api/user/me/wallet        — Привязать TON кошелёк
```

## Telegram Bot Commands

```
/start          — Приветствие + кнопка Mini App
/help           — Список команд
/mydeals        — Список активных сделок
/deal_{id}      — Детали конкретной сделки
/addchannel     — Добавить канал (conversation)
/mycampaigns    — Мои кампании
/submitcreative — Отправить креатив для сделки (conversation)
```

### Bot Conversations (Grammy Conversations Plugin):
1. **addChannel** — пошаговое добавление канала: ввод @username → проверка бота → установка цен → выбор менеджеров
2. **submitCreative** — отправка креатива: выбор сделки → отправка текста + медиа → превью → подтверждение
3. **schedulePost** — выбор времени публикации: дата + время или "Сейчас"

### Bot Notifications:
- Новое предложение сделки / отклик на кампанию
- Сделка принята/отклонена
- Оплата получена (с суммой и TX hash)
- Креатив на проверке (с превью)
- Креатив одобрен/на доработку (с комментарием)
- Пост опубликован (со ссылкой)
- Пост удалён/отредактирован (предупреждение)
- Деньги выплачены/возвращены (с TX hash)
- Таймаут сделки (с объяснением)

## Background Workers (BullMQ)

### payment-monitor
- **Интервал:** каждые 30 секунд
- **Задача:** Проверка балансов escrow для AWAITING_PAYMENT
- **Retry:** 3 попытки с exponential backoff
- **Concurrency:** 1 (последовательная обработка)

### post-verifier
- **Интервал:** каждые 5 минут
- **Задача:** forwardMessage check для POSTED сделок (< 24h)
- **Также:** trigger payout для POSTED сделок (>= 24h без проблем)

### deal-timeout
- **Интервал:** каждые 5 минут
- **Задача:** Проверка expiresAt для не-terminal статусов
- **Действия:** Авто-отмена + рефанд если funded

### stats-updater
- **Интервал:** каждые 6 часов
- **Задача:** Обновление статистики всех активных каналов
- **Метод:** Bot API (subscribers) + MTProto (views, shares, reactions)
- **Сохранение:** snapshot в ChannelStats

## Deploy (Railway)

### Сервисы на Railway:
1. **Web Service** — Node.js (API + Bot + Static)
2. **PostgreSQL** — Railway addon
3. **Redis** — Railway addon

### Деплой процесс:
```
git push origin main → Railway:
1. Собирает Docker образ
2. Запускает prisma migrate deploy
3. Собирает React (vite build)
4. Запускает сервер
```

### Dockerfile
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN cd web && npm ci && npm run build
RUN npm run build
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
```

### Graceful Shutdown
```
SIGTERM →
  1. Stop accepting new requests
  2. Close BullMQ workers (wait for current jobs)
  3. Close Prisma connection
  4. Close Fastify server
  5. Exit
```
