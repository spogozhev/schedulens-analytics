# Аналитика расписания преподавателей

Веб-сервис для анализа загруженности преподавателей и аудиторий на основе JSON-файлов
расписания. Скрипт-импортёр объединяет 1000+ файлов в единую базу данных, а дашборд
предоставляет рейтинги, графики и тепловые карты с учётом **одновременных занятий**
(когда преподаватель ведёт несколько групп в одно время).

---

## Возможности

- **Импорт расписания** из JSON-файлов (включая подпапки) в SQLite через Prisma.
- **Парсинг русских дат**: одиночные `"2.6"` и диапазоны `"с 17.2 по 19.5 (14)"`.
- **Учёт одновременных занятий**: события преподавателя с пересекающимися интервалами
  группируются, время учитывается только один раз (эффективная нагрузка).
- **Дедупликация по лекции**: одна физическая лекция для нескольких групп
  считается как один слот утилизации аудитории.
- **Окончание +1 ч 30 мин** по умолчанию, если в источнике не указано `End`.
- **Фильтры по периоду, типу занятий,Granularity; показ/скрытие отменённых.
- **Рейтинги преподавателей и аудиторий** с сортировкой и поиском.
- **Детальные диалоги** с KPI, графиками, тепловыми картами, списком занятий.
- **Тёмная/светлая тема**, адаптивный дизайн (мобильный/десктоп).

---

## Технологический стек

| Слой | Технология |
|------|------------|
| Фреймворк | **Next.js 16** (App Router, Turbopack) |
| Язык | **TypeScript 5** |
| Стилизация | **Tailwind CSS 4** + **shadcn/ui** (New York) |
| База данных | **SQLite** через **Prisma ORM 6** |
| Состояние клиента | **Zustand** (фильтры) + **TanStack Query 5** (сервер) |
| Графики | **Recharts** + собственная heatmap-сетка |
| Иконки | **Lucide React** |
| Темы | **next-themes** |
| Runtime | **Bun 1.3+** |

---

## Предварительные требования

- **Bun ≥ 1.3** — пакетный менеджер и runtime ([установка](https://bun.sh/docs/installation))
- **Node.js ≥ 20** (опционально, нужен только если не используется Bun)
- ОС: Linux / macOS / Windows (WSL рекомендуется)

Проверка:

```bash
bun --version   # должно быть >= 1.3
```

---

## Быстрый старт (разработка)

```bash
# 1. Установить зависимости
bun install

# 2. Применить схему базы данных (создаст SQLite в db/custom.db)
bun run db:push

# 3. Импортировать JSON-файлы расписания из папки ./upload
bun run scripts/import-schedules.ts ./upload

# 4. Запустить dev-сервер (порт 3000)
bun run dev
```

Откройте дашборд в **Preview Panel** справа в интерфейсе IDE или по адресу
`http://localhost:3000` (в локальной разработке).

---

## Развёртывание

### Шаг 1. Клонирование и установка

```bash
git clone <repo-url>
cd <project-dir>
bun install
```

### Шаг 2. Настройка переменных окружения

Создайте файл `.env` в корне проекта:

```env
# Путь к SQLite-файлу (абсолютный или относительный)
DATABASE_URL=file:/home/z/my-project/db/custom.db
```

> При необходимости можно заменить на PostgreSQL/MySQL — для этого отредактируйте
> `prisma/schema.prisma` (поле `provider` в `datasource db`) и замените `DATABASE_URL`.

### Шаг 3. Инициализация базы данных

```bash
# Сгенерировать Prisma-клиент и применить схему
bun run db:push

# (опционально) Сбросить базу с потерей данных
bun run db:push --force-reset
```

Создаётся файл `db/custom.db` со следующими таблицами:

- `Educator` — преподаватели (id = `EducatorMasterId` из источника)
- `Location` — аудитории (уникальны по `displayName`, с координатами)
- `Subject` — дисциплины
- `Group` — учебные потоки / группы
- `ScheduleEvent` — события расписания (одна строка = один преподаватель × один слот)
- `ScheduleEventLocation`, `ScheduleEventEducator`, `ScheduleEventGroup` — связи M:N

### Шаг 4. Импорт данных

Положите все JSON-файлы расписания в одну директорию (можно с подпапками — обход
рекурсивный). Формат файла — стандартный экспорт портала расписания СПбГУ с полями
`EducatorMasterId`, `From`, `To`, `EducatorEventsDays[].DayStudyEvents[]`.

```bash
bun run scripts/import-schedules.ts /путь/к/папке/с/json
```

Скрипт:
- обходит директорию рекурсивно (поддержка 1000+ файлов);
- парсит даты `"D.M"` и диапазоны `"с D.M по D.M (N)"`;
- выводит год из терминального диапазона файла (`From`/`To`) и проверяет
  соответствие дню недели, указанному в поле `Day`;
- если `End` не задан — устанавливает `Start + 90 минут` и помечает
  `hasInferredEnd = true`;
- для каждого преподавателя вычисляет **одновременные группы** (sweep-line по
  пересечению интервалов) и помечает `simultaneousGroupId`;
- идемпотентен — повторный запуск очищает старые данные и пересоздаёт.

**Пример вывода:**

```
Importing schedules from: ./upload
Found 5 JSON file(s).
  Processed 5/5 files, 1980 events so far.
Imported 1980 events from 5 file(s) (0 failed).
Computing simultaneous groups...
Simultaneous: 5 teachers, 309 groups, 1362 events flagged.
--- Summary ---
Teachers: 5
Events: 1980
Locations: 54
Subjects: 255
Groups: 163
  Kind 0 (Индивидуальные мероприятия): 29
  Kind 1 (Регулярные занятия): 1565
  Kind 2 (Сессия / консультации): 386
```

### Шаг 5. Запуск

#### Режим разработки

```bash
bun run dev
```

Dev-сервер слушает порт **3000**, поддерживает hot-reload. Лог пишется в `dev.log`.

#### Продакшен-сборка

```bash
# Собрать standalone-бандл в .next/standalone/
bun run build

# Запустить продакшен-сервер (порт 3000)
bun run start
```

---

## Скрипты `package.json`

| Скрипт | Действие |
|--------|---------|
| `bun run dev` | Dev-сервер с hot-reload (порт 3000) |
| `bun run build` | Продакшен-сборка standalone-бандла |
| `bun run start` | Запуск продакшен-сервера |
| `bun run lint` | Проверка ESLint |
| `bun run db:push` | Применить схему Prisma к SQLite (с потерей при конфликтах) |
| `bun run db:generate` | Перегенерировать Prisma-клиент |
| `bun run db:migrate` | Создать и применить миграцию |
| `bun run db:reset` | Полный сброс базы (миграции) |

Запуск скрипта импорта:

```bash
bun run scripts/import-schedules.ts [директория]
# по умолчанию: ./upload
```

### Пересчёт одновременных групп без реимпорта

Если вы изменили правило группировки одновременных занятий (например,
правило обработки back-to-back событий — когда конец одного занятия
совпадает с началом следующего), можно пересчитать `simultaneousGroupId`
во всей базе без повторного парсинга JSON-файлов:

```bash
bun run scripts/recompute-simultaneous.ts
```

Скрипт:
- сбрасывает все `simultaneousGroupId` в `null`;
- для каждого преподавателя заново прогоняет sweep-line алгоритм со строгим
  правилом пересечения (`b.start < a.maxEnd` — back-to-back события
  `a.end === b.start` не объединяются);
- идемпотентен — повторный запуск даёт тот же результат.

Это в десятки раз быстрее, чем полный реимпорт 5000+ JSON-файлов.

---

## Структура проекта

```
.
├── prisma/
│   └── schema.prisma              # схема БД
├── db/
│   └── custom.db                  # SQLite (создаётся автоматически)
├── upload/                        # исходные JSON-файлы (ваш набор)
├── scripts/
│   ├── import-schedules.ts        # импорт + расчёт одновременных групп
│   └── recompute-simultaneous.ts   # пересчёт одновременных групп без реимпорта
├── src/
│   ├── app/
│   │   ├── layout.tsx             # корневой layout (ThemeProvider, QueryProvider)
│   │   ├── page.tsx               # единственная страница — Dashboard
│   │   ├── globals.css            # Tailwind + custom-scrollbar
│   │   └── api/
│   │       └── analytics/
│   │           ├── overview/      # KPI, топ-преподаватели/аудитории, by-kind
│   │           ├── teachers/      # рейтинг преподавателей (sort, top-N, search)
│   │           ├── rooms/         # рейтинг аудиторий (sort, top-N, search)
│   │           ├── timeline/      # ведра по неделям/дням, heatmap 7×24
│   │           ├── teacher/[id]/  # детали преподавателя
│   │           └── room/[id]/     # детали аудитории
│   ├── components/
│   │   ├── ui/                    # shadcn/ui компоненты (уже установлены)
│   │   └── dashboard/
│   │       ├── dashboard.tsx      # главный shell (хедер + табы + футер)
│   │       ├── filters-bar.tsx    # фильтры (даты, тип, granularity, пресеты)
│   │       ├── overview-tab.tsx   # обзор: KPI + графики + heatmap
│   │       ├── teachers-tab.tsx   # таблица рейтинга преподавателей
│   │       ├── rooms-tab.tsx      # таблица рейтинга аудиторий
│   │       ├── teacher-detail.tsx # диалог деталей преподавателя
│   │       ├── room-detail.tsx    # диалог деталей аудитории
│   │       ├── charts.tsx         # LineChart, AreaChart, BarChart, Pie, Heatmap
│   │       ├── kpi-card.tsx       # карточка KPI с цветным акцентом
│   │       ├── palette.ts         # палитра без индиго/синего
│   │       ├── theme-provider.tsx  # обёртка next-themes
│   │       ├── theme-toggle.tsx   # переключатель тёмной/светлой темы
│   │       └── query-provider.tsx # обёртка TanStack Query
│   └── lib/
│       ├── db.ts                  # экземпляр PrismaClient
│       ├── analytics.ts           # computeTeacherWorkloads, computeRoomWorkloads, timeline
│       ├── dashboard-store.ts     # Zustand: фильтры + выбранный преподаватель/аудитория
│       └── api-hooks.ts           # TanStack Query хуки для эндпоинтов
├── .env                           # DATABASE_URL=...
├── package.json
└── README.md
```

---

## API дашборда

Все эндпоинты находятся под `/api/analytics/*` и принимают query-параметры:

| Параметр | Тип | Описание |
|----------|-----|----------|
| `from` | ISO-дата | Начало периода (по `startDateTime`) |
| `to` | ISO-дата | Конец периода (по `startDateTime`) |
| `kindCode` | `0|1|2|all` | Тип занятия (0=индив., 1=регулярные, 2=сессия) |
| `includeCanceled` | `true|false` | Включать ли отменённые (по умолчанию `false`) |

### Эндпоинты

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/api/analytics/overview` | KPI, by-kind, weekly timeline, топ-5 преподавателей/аудиторий, опции фильтров |
| GET | `/api/analytics/teachers?sort=&top=` | Рейтинг преподавателей (`sort`: `effectiveHours` \| `scheduledHours` \| `eventsCount` \| `simultaneousGroups` \| `simultaneousEvents` \| `name`) |
| GET | `/api/analytics/rooms?sort=&top=` | Рейтинг аудиторий (`sort`: `hours` \| `events` \| `uniqueLectures` \| `conflicts` \| `name`) |
| GET | `/api/analytics/timeline?granularity=` | Бакеты по неделям/дням, by-day-of-week, by-hour, heatmap 7×24 (`granularity`: `day` \| `week`) |
| GET | `/api/analytics/teacher/[id]` | Полная детализация преподавателя: KPI, графики, топ-10 дисциплин, одновременные группы, последние 100 занятий |
| GET | `/api/analytics/room/[id]` | Полная детализация аудитории: KPI, конфликты, графики, топ-10 дисциплин и преподавателей, последние 100 лекций |

Пример:

```bash
curl "http://localhost:3000/api/analytics/teachers?includeCanceled=false&sort=effectiveHours&top=10"
```

---

## Ключевые алгоритмы

### Одновременные группы (per teacher)

После импорта для каждого преподавателя события сортируются по `startDateTime`,
затем sweep-line объединяет **строго пересекающиеся** интервалы в цепочки. Все
события в одной цепочке получают общий `simultaneousGroupId`.

- **Запланированные часы** = Σ `durationMinutes` всех событий (с двойным учётом
  одновременных).
- **Эффективные часы** = Σ `maxEnd − minStart` по группам (без двойного учёта).
- **Экономия** = запланированные − эффективные.

#### Правило back-to-back (касание границ не считается пересечением)

Если одно занятие заканчивается в 14:00, а другое начинается в 14:00 — это
**последовательные** занятия (back-to-back), а **не одновременные**. Они не
объединяются в одну группу и не считаются конфликтом бронирования аудитории.

Реализация:
- В sweep-line для одновременных групп: событие B добавляется в текущую цепочку
  только если `B.start < chainMaxEnd` (строгое неравенство). Условие
  `B.start === chainMaxEnd` начинает новую цепочку.
- В детекции конфликтов аудиторий: цикл прерывается, когда
  `B.start >= A.end` — то есть `B.start === A.end` (касание границ) тоже
  прерывает цикл и не добавляет конфликт.

Цепочка всё же может объединять back-to-back события, если они оба
пересекаются с каким-то третьим событием. Например, A: 18:40–19:00,
B: 19:00–20:30 и C: 18:40–19:10 — A и B касаются границами, но C пересекается
с обоими, поэтому все три входят в одну цепочку. Это корректно: преподаватель
не может одновременно вести A, B и C.

### Дедупликация аудиторий (lectureHash)

Один и тот же поток-лекция появляется в JSON-файлах всех преподавателей, кто её
ведёт (соавторов), и для каждой группы студентов. Хэш `lectureHash` строится из
`subject + start + end + sorted(locations) + sorted(educators)` (без групп),
поэтому все строки одной физической лекции сливаются в **один уникальный слот**
для подсчёта загрузки аудитории.

### Конфликты аудиторий

Перекрытия во времени между **разными** `lectureHash` в одной аудитории. Например,
преподаватель ведёт два разных предмета в одной аудитории в одно время — это
конфликт, а не одновременная лекция. Back-to-back лекции (одна заканчивается
в 14:00, следующая начинается в 14:00) **не считаются конфликтом**.

---

## Устранение неполадок

| Симптом | Решение |
|---------|---------|
| `Cannot find module '@prisma/client'` | `bun run db:generate` |
| `Unknown field 'lectureHash'` после изменения схемы | перезапустить dev-сервер: `kill <pid>; bun run dev` |
| Ошибка `We found changes that cannot be executed` при `db:push` | `bun run db:push --force-reset` (с потерей данных) |
| Импорт пишет `0 events so far` | проверьте, что папка содержит `.json`-файлы нужного формата (`EducatorMasterId`, `EducatorEventsDays`) |
| Дашборд показывает `Нет данных` | запустите импорт заново и убедитесь, что `db/custom.db` создан |
| Сервер не стартует на порту 3000 | проверьте, что порт свободен: `lsof -i :3000` |
| Prisma-логи засоряют консоль | проверьте `src/lib/db.ts` — `log` должен быть `['error', 'warn']` |

---

## Развёртывание на сервере (production)

### Через Bun standalone

```bash
# На сервере:
git clone <repo> && cd <repo>
bun install --production
bun run db:push
bun run scripts/import-schedules.ts /путь/к/json

# Собрать
bun run build

# Запустить (можно под systemd / pm2 / supervisord)
NODE_ENV=production bun run start
```

### Docker (минимальный пример)

```dockerfile
FROM oven/bun:1.3
WORKDIR /app
COPY . .
RUN bun install --production
RUN bun run db:push
RUN bun run build
EXPOSE 3000
CMD ["bun", "run", "start"]
```

```bash
docker build -t schedule-analytics .
docker run -p 3000:3000 -v $(pwd)/db:/app/db -v /path/to/json:/data schedule-analytics \
  sh -c "bun run scripts/import-schedules.ts /data && bun run start"
```

### Обновление данных

```bash
# 1. Положить новые JSON в папку
# 2. Перезапустить импорт (он идемпотентный)
bun run scripts/import-schedules.ts /путь/к/json
# 3. Перезапустить сервер не нужно — дашборд читает БД в реальном времени
```

---

## Лицензия

Учебный/внутренний проект. Используйте свободно.
