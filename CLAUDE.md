# Ad Marketplace — Telegram Mini App

## Проект
MVP маркетплейса рекламы в Telegram-каналах. Соединяет владельцев каналов и рекламодателей. Escrow-сделки на TON.

**Конкурс:** Telegram Ad Marketplace Contest
**Дедлайн:** 16 февраля 2026
**Грант:** $15,000+ $BUILD

## Стек технологий

| Компонент | Технология |
|-----------|-----------|
| Backend | Node.js + Fastify |
| Frontend (Mini App) | React + Vite + @telegram-apps/telegram-ui |
| База данных | PostgreSQL (Prisma ORM) |
| Кэш/очереди | Redis (BullMQ) |
| Telegram Bot | Grammy |
| Telegram Stats | GramJS (MTProto) — stats.getBroadcastStats |
| TON интеграция | @ton/ton, @ton/crypto |
| Деплой | Railway (git push → автодеплой) |
| Язык | TypeScript (везде) |

## Архитектура

### Монолит
Один Node.js сервер:
- Fastify API (REST endpoints)
- Telegram Bot webhook handler
- Раздаёт React static files
- BullMQ workers для фоновых задач
- GramJS MTProto client для channel stats

### Структура проекта
```
Marketplace-Contest/
├── CLAUDE.md
├── README.md
├── package.json
├── tsconfig.json
├── prisma/
│   └── schema.prisma          # Схема БД (10 моделей)
├── src/
│   ├── index.ts               # Entry point: Fastify + Bot + Workers
│   ├── config.ts              # Env переменные (zod validation)
│   ├── bot/
│   │   ├── index.ts           # Grammy bot + webhook
│   │   ├── commands/          # /start, /help, /mydeals, /addchannel
│   │   ├── conversations/     # addChannel, submitCreative, schedulePost
│   │   └── middleware/        # Auth, logging
│   ├── api/
│   │   ├── index.ts           # Fastify routes setup
│   │   ├── routes/
│   │   │   ├── channels.ts    # CRUD + admins + managers + stats
│   │   │   ├── campaigns.ts   # CRUD + apply
│   │   │   ├── deals.ts       # CRUD + state transitions + escrow
│   │   │   ├── auth.ts        # Telegram WebApp auth
│   │   │   └── stats.ts       # Channel statistics
│   │   └── middleware/
│   │       ├── auth.ts        # Валидация Telegram initData + JWT
│   │       └── verify-admin.ts # Re-check admin status (кэш Redis 5мин)
│   ├── services/
│   │   ├── telegram.ts        # Bot API (subscribers, chat info)
│   │   ├── mtproto.ts         # GramJS MTProto (stats.getBroadcastStats)
│   │   ├── ton.ts             # TON: escrow wallets, payments, payouts
│   │   ├── deals.ts           # State machine, бизнес-логика сделок
│   │   ├── channels.ts        # Каналы + PR manager flow
│   │   └── posting.ts         # Авто-постинг + верификация
│   ├── workers/
│   │   ├── payment-monitor.ts # Мониторинг escrow балансов (30 сек)
│   │   ├── post-verifier.ts   # Проверка постов: forwardMessage + hash (5 мин)
│   │   ├── deal-timeout.ts    # Авто-отмена зависших сделок (5 мин)
│   │   └── stats-updater.ts   # Обновление статистики каналов (6 часов)
│   └── utils/
│       ├── ton-wallet.ts      # AES-256-GCM шифрование, keypair generation
│       └── telegram-auth.ts   # Верификация Telegram WebApp данных
├── web/                       # React Mini App
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── main.tsx           # AppRoot + QueryClientProvider + Router
│       ├── api/               # HTTP клиент + React Query hooks
│       ├── pages/
│       │   ├── MarketplacePage.tsx  # Channels + Campaigns + filters
│       │   ├── ChannelPage.tsx      # Детали канала + stats
│       │   ├── CampaignPage.tsx     # Бриф + Apply
│       │   ├── DealsPage.tsx        # Мои сделки
│       │   ├── DealPage.tsx         # Детали + timeline
│       │   ├── PaymentPage.tsx      # QR + адрес + deeplinks
│       │   └── ProfilePage.tsx      # Профиль + каналы + кошелёк
│       ├── components/
│       │   ├── AppShell.tsx         # Tabbar + BackButton + safe areas
│       │   ├── ChannelCard.tsx      # Cell-based карточка
│       │   ├── CampaignCard.tsx
│       │   ├── DealCard.tsx
│       │   ├── DealTimeline.tsx     # Timeline статуса
│       │   ├── TonPayment.tsx       # QR + адрес + deeplinks
│       │   ├── FilterModal.tsx
│       │   ├── ChannelSelectModal.tsx
│       │   └── CopyableAddress.tsx
│       └── hooks/
│           ├── useTelegram.ts       # WebApp SDK hooks
│           ├── useMainButton.ts
│           └── useBackButton.ts
└── docs/
    ├── CONTEST_SPEC.md
    ├── ARCHITECTURE.md
    └── IMPLEMENTATION_PLAN.md
```

## TON Escrow — Кастодиальный подход

### Принцип
Для каждой сделки генерируется НОВЫЙ TON-кошелёк. Ключи шифруются AES-256-GCM и хранятся в отдельной таблице EscrowWallet.

### Flow
```
1. Сделка создана → генерируем keypair → EscrowWallet в БД
2. Рекламодатель получает адрес для оплаты (+ QR + deeplinks)
3. Worker мониторит баланс (каждые 30 сек)
4. Оплата получена → статус FUNDED
5. Owner готовит креатив через бота → рекламодатель одобряет
6. Авто-публикация в канал → worker проверяет 24 часа
7. Всё ОК → hot wallet gas → deploy → payout owner-у
8. Проблема → hot wallet gas → deploy → refund рекламодателю
```

### Безопасность ключей
- Приватные ключи в отдельной таблице EscrowWallet
- Шифрование AES-256-GCM (не CBC)
- IV и auth tag хранятся вместе с шифротекстом
- Ключ шифрования — `ESCROW_ENCRYPTION_KEY` env
- Доступ к ключам ТОЛЬКО из `src/services/ton.ts`
- Никогда не логируем, не возвращаем в API

## Правила разработки

### Приоритеты
1. **100% покрытие спецификации** — оба flow маркетплейса, escrow, stats, creative workflow
2. **Escrow безопасность** — state machine, admin re-check, AES-256-GCM
3. **Чистый код** — ready to open source, модульная архитектура
4. **MVP** — не усложняй, но закрой ВСЕ требования

### Код
- TypeScript strict mode
- ESM modules ("type": "module")
- Prisma для всех DB операций
- Все env переменные в `src/config.ts` (zod validation)
- Обработка ошибок: try/catch + Fastify error handler + pino logging
- Каждый сервис — отдельный файл с чистым API
- State machine для Deal с валидацией переходов

### Telegram Bot
- Webhook режим (не long polling)
- Grammy framework
- Conversations plugin для диалогов (addChannel, submitCreative, schedulePost)
- Все текстовые сообщения через бота (не в Mini App)
- Handler edited_channel_post для мониторинга постов
- Admin re-check на финансовых операциях

### Telegram Stats (MTProto)
- GramJS для stats.getBroadcastStats
- Кэш в Redis (TTL 1 час)
- Fallback на Bot API если MTProto недоступен
- Known limitations: language и premium stats не доступны через API

### Mini App (React)
- @telegram-apps/telegram-ui для нативного Telegram-вида
- @telegram-apps/sdk-react для WebApp SDK hooks
- @tanstack/react-query для data fetching и кэширования
- 3 вкладки: Marketplace / My Deals / Profile
- MainButton, BackButton, HapticFeedback, showConfirm()
- CSS Modules для кастомных стилей

### Git
- Коммиты на английском
- Формат: `Short description\n\nCo-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

## Environment Variables
```env
# Telegram Bot
BOT_TOKEN=              # от @BotFather
WEBAPP_URL=             # Railway URL

# Telegram MTProto (для channel stats)
TELEGRAM_API_ID=        # from my.telegram.org
TELEGRAM_API_HASH=      # from my.telegram.org
TELEGRAM_SESSION=       # GramJS StringSession

# Database
DATABASE_URL=           # PostgreSQL (Railway)
REDIS_URL=              # Redis (Railway)

# TON
TON_NETWORK=testnet     # testnet для MVP
TON_API_KEY=            # toncenter.com API key
ESCROW_ENCRYPTION_KEY=  # AES-256-GCM ключ
HOT_WALLET_MNEMONIC=    # Горячий кошелёк (gas для deploy escrow)
PLATFORM_FEE_PERCENT=0  # 0% для MVP

# App
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

## 6-дневный план

| День | Фокус | Результат |
|------|-------|-----------|
| 1 | Backend + DB + Auth + MTProto | Сервер, бот, auth, GramJS подключён |
| 2 | Маркетплейс + Stats + Filters | Каналы, кампании, stats, admin re-check, apply flow |
| 3 | TON Escrow | EscrowWallet, AES-256-GCM, state machine, workers |
| 4 | Creative + Auto-posting | Креатив через бота, scheduled posting, post verification |
| 5 | Mini App (React) | @telegram-apps/telegram-ui, 3 tabs, QR, timeline |
| 6 | Интеграция + Deploy | Railway, E2E testing, README, submission |

## Ссылки
- Спецификация: `docs/CONTEST_SPEC.md`
- Архитектура: `docs/ARCHITECTURE.md`
- План по дням: `docs/IMPLEMENTATION_PLAN.md`
- Contest App: https://t.me/contests_app_bot/app?startapp=contest-29374b12297f030ed6003296c95e37c7
- Сообщество: @tools_community
