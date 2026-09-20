# Аналитика расписания преподавателей

Веб-сервис для анализа загруженности преподавателей и аудиторий СПбГУ на основе
JSON-файлов расписания и кадровой выгрузки. Дашборд предоставляет KPI, рейтинги,
графики и тепловые карты с учётом **одновременных занятий** (когда преподаватель
ведёт несколько групп в одно время) и **дедупликации совместных лекций**
(когда одну лекцию ведут несколько преподавателей).

---

## Возможности

### Данные и импорт
- **Импорт расписаний** из JSON-файлов (папка `upload/timetable`, обход рекурсивный)
  в SQLite через Prisma.
- **Парсинг русских дат**: одиночные `"2.6"` и диапазоны `"с 17.2 по 19.5 (14)"`.
- **Периоды (семестры)**: `DateRangeDisplayText` + `From`/`To` файла сохраняются в
  справочник `DateRange`, каждое событие ссылается на свой период.
- **Формы занятий**: из хвоста названия предмета («…, лекция») извлекается форма
  (белый список из 29 форм) → справочник `LessonForm`, событие ссылается на форму.
- **Адреса аудиторий**: из названия аудитории парсится адрес («<Улица>, д. <дом>»)
  → справочник `Address`, аудитория ссылается на адрес.
- **Кадровый состав**: `upload/staff/*.json` — полный штат и должности
  (`Position` + `Department`) → справочник `Department` и таблица `Employment`.
- **Текущие сотрудники**: `upload/employees.json` — привязка преподавателей к
  подразделениям первого уровня (`TopLevelUnit`) по ФИО с разрешением дублей
  по пересечению должностей.
- **Учёт одновременных занятий**: события преподавателя с пересекающимися
  интервалами группируются (`simultaneousGroupId`), время учитывается один раз
  (эффективная нагрузка).
- **Дедупликация по лекции**: одна физическая лекция (несколько групп,
  несколько со-преподавателей) считается одним слотом утилизации аудитории.
- **Окончание +1 ч 30 мин** по умолчанию, если в источнике не указано `End`.

### Дашборд
- **Обзор**: KPI-карточки, баннер одновременных занятий, динамика по неделям/дням,
  распределения по типам и формам занятий, по месяцам × типам (stacked),
  топ-10 преподавателей и аудиторий, тепловая карта «день × час».
- **Преподаватели**: рейтинг с фильтром по подразделению первого уровня
  (выпадающий список), поиском, сортировками и пагинацией.
- **Аудитории**: рейтинг с мультивыбором адресов, поиском, сортировками, пагинацией.
- **Диалоги деталей** (800px): KPI, должности преподавателя, графики,
  конфликты, последние занятия.
- **Фильтры**: периоды (мультивыбор из `DateRange`), формы занятий (мультивыбор),
  тип занятий, показ/скрытие отменённых.
- **Тёмная/светлая тема**, адаптивный дизайн.

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

# 3. Импортировать данные (расписания — из ./upload/timetable)
bun run scripts/import-schedules.ts ./upload/timetable

# 4. Запустить dev-сервер (порт 3000)
bun run dev
```

---

## Выбор СУБД: SQLite или PostgreSQL

Поддерживаются обе СУБД; вариант выбирается при развертывании через `DATABASE_URL`.
Весь код приложения (включая raw-SQL аналитику) работает с обоими диалектами —
диалект определяется автоматически по протоколу строки подключения.

### Вариант SQLite (по умолчанию)

```env
DATABASE_URL=file:/путь/к/db/custom.db
```

```bash
bun run scripts/use-db.ts sqlite   # ставит provider = "sqlite" в schema.prisma
bun run db:generate
bun run db:push
```

### Вариант PostgreSQL

```env
DATABASE_URL=postgresql://user:password@host:5432/analytics?schema=public
```

```bash
bun run scripts/use-db.ts postgres   # ставит provider = "postgresql"
bun run db:generate                  # обязателен после смены провайдера!
bun run db:push
```

### Заполнение данными (одинаково для обеих СУБД)

```bash
bun run scripts/import-schedules.ts ./upload/timetable
bun run scripts/import-staff.ts ./upload/staff
bun run scripts/import-employees.ts ./upload/employees.json
```

> ⚠️ Данные между СУБД не переносятся автоматически: на новой СУБД запустите
> импортеры заново (они полностью восстанавливают состояние из исходных JSON).
> Переключение провайдера требует `db:generate` — перезапустите dev/production
> сервер после переключения.

Особенности SQLite-режима: `connection_limit=1` и `PRAGMA cache_size/temp_store`
(включаются автоматически в `src/lib/db.ts`); для PostgreSQL тюнинг делается на
стороне сервера (`shared_buffers`, `work_mem`).

---

## Структура исходных данных

```
upload/
├── timetable/        # JSON-файлы расписаний преподавателей
│   └── 1059.json …
├── staff/            # кадровая выгрузка (файлы по первой букве фамилии)
│   └── А.json …
└── employees.json    # текущие сотрудники (подразделения 1-го уровня)
```

---

## Скрипты импорта

### `scripts/import-schedules.ts` — расписания

```bash
bun run scripts/import-schedules.ts [директория]   # по умолчанию ./upload/timetable
```

- парсит даты `"D.M"` и диапазоны `"с D.M по D.M (N)"`; год определяется по
  терминальному диапазону файла (`From`/`To`) с проверкой дня недели;
- создаёт/находит справочники: `DateRange` (период файла), `LessonForm`
  (форма занятия из хвоста `Subject`), `Address` (адрес из названия аудитории);
- если `End` не задан — `Start + 90 минут`, `hasInferredEnd = true`;
- денормализует **основную аудиторию** события (`ScheduleEvent.locationId`);
  дополнительные аудитории — в `ScheduleEventLocation`;
- вычисляет **одновременные группы** (sweep-line) и помечает `simultaneousGroupId`;
- **не очищает базу**: дубликаты детектируются по составному ключу
  `(educatorId, startDateTime, subjectId, globalEventHash)`; пропущенные
  «легаси»-строки обогащаются `dateRangeId` / `lessonFormId`.

### `scripts/import-staff.ts` — штат и должности

```bash
bun run scripts/import-staff.ts [директория]   # по умолчанию ./upload/staff
```

- upsert `Educator` по `Id` (`DisplayName` → displayName, `FullName` → longName);
  преподаватели без расписаний тоже попадают в базу (полный штат);
- должности (`Position` + `Department`) заменяются содержимым выгрузки,
  название подразделения резолвится в справочник `Department`.

### `scripts/import-employees.ts` — текущие сотрудники

```bash
bun run scripts/import-employees.ts [файл]   # по умолчанию ./upload/employees.json
```

- сопоставляет сотрудников с преподавателями по нормализованному ФИО
  (нижний регистр, ё→е, схлопнутые пробелы);
- для одинаковых ФИО — бипартитное назначение по пересечению должностей
  (+10 за совпадение Position и `second_level_unit`, +1 за Position);
  назначение принимается только при уникальном ненулевом максимуме;
- создаёт словарь `TopLevelUnit` и проставляет `Educator.topLevelUnitId`;
- записи «файл → преподаватель» сохраняются в `EmployeeMatch` (идемпотентность).

> ⚠️ Импорты **не очищают базу**. Повторный запуск того же файла пропускает
> дубликаты (и дозаполняет новые поля). Для полной очистки —
> `bun run db:push --force-reset` с потерей данных.

### Разовые миграции данных

Скрипты `migrate-primary-location.ts`, `migrate-lesson-forms.ts`,
`migrate-departments.ts`, `migrate-addresses.ts` заполняли денормализованные
поля на старых наборах данных. На свежей базе после полного импорта они
**не требуются** — импортёры заполняют эти поля сами.

---

## Скрипты `package.json`

| Скрипт | Действие |
|--------|---------|
| `bun run dev` | Dev-сервер с hot-reload (порт 3000) |
| `bun run build` | Продакшен-сборка standalone-бандла |
| `bun run start` | Запуск продакшен-сервера |
| `bun run lint` | Проверка ESLint |
| `bun run db:push` | Применить схему Prisma к SQLite |
| `bun run db:generate` | Перегенерировать Prisma-клиент |
| `bun run db:migrate` | Создать и применить миграцию |
| `bun run db:reset` | Полный сброс базы (миграции) |
| `bun run db:schema` | Экспорт структуры БД с ER-диаграммой в `db_schema.md` |

### Пересчёт одновременных групп без реимпорта

```bash
bun run scripts/recompute-simultaneous.ts
```

Сбрасывает `simultaneousGroupId` и заново прогоняет sweep-line по каждому
преподавателю (строгое пересечение: back-to-back не объединяются).
Идемпотентен и намного быстрее полного реимпорта.

### Проверка ответов API (golden-файлы)

`scripts/golden-save.ts` сохраняет ответы всех эндпоинтов в JSON, а
`scripts/golden-check.ts` сверяет их после рефакторингов — полезно при
изменении запросов или схемы:

```bash
DATABASE_URL="file:<abs path>" GOLDEN_DIR=/tmp/golden DB_LOG_SLOW_MS=-1 bun scripts/golden-save.ts
DATABASE_URL="file:<abs path>" GOLDEN_DIR=/tmp/golden DB_LOG_SLOW_MS=-1 bun scripts/golden-check.ts
```

### Экспорт схемы БД

```bash
bun run db:schema   # → db_schema.md (Mermaid ER-диаграмма + описание таблиц)
```

---

## Производительность и логирование

- Тяжёлые агрегации дашборда выполняются **raw SQL с GROUP BY** (не загрузкой
  строк в JS) — см. `src/lib/analytics.ts`;
- `src/lib/db.ts` использует `connection_limit=1` и `PRAGMA cache_size = 128МБ`
  + `temp_store = MEMORY` (для SQLite это даёт ~4× на join'ах);
- **логирование выключено по умолчанию**; для диагностики включается
  переменными окружения:

| Переменная | Значение | Что делает |
|---|---|---|
| `DB_LOG_SLOW_MS` | `0` — все SQL-запросы, `200` — только >200мс, `-1`/не задано — выключено | лог `[db   12ms] SELECT …` |
| `ANALYTICS_LOG_SLOW_MS` | аналогично | лог шагов `[t   123ms] kpi:sql-agg` |

---

## Структура проекта

```
.
├── prisma/
│   └── schema.prisma                # схема БД (14 таблиц)
├── db/
│   └── custom.db                    # SQLite (создаётся автоматически)
├── upload/
│   ├── timetable/                   # JSON расписаний преподавателей
│   ├── staff/                       # кадровая выгрузка (по буквам)
│   └── employees.json               # текущие сотрудники
├── scripts/
│   ├── import-schedules.ts          # импорт расписаний (+ периоды, формы, адреса)
│   ├── import-staff.ts              # штат и должности
│   ├── import-employees.ts          # текущие сотрудники → подразделения 1-го уровня
│   ├── lesson-forms.ts              # словарь форм занятий + парсер
│   ├── address-parse.ts             # парсер адреса из названия аудитории
│   ├── migrate-*.ts                 # разовые миграции данных (уже применены)
│   ├── recompute-simultaneous.ts    # пересчёт одновременных групп
│   ├── export-schema.ts             # экспорт схемы в db_schema.md
│   └── golden-save.ts / golden-check.ts  # регрессионная проверка ответов API
├── src/
│   ├── app/
│   │   ├── layout.tsx               # корневой layout (ThemeProvider, QueryProvider)
│   │   ├── page.tsx                 # единственная страница — Dashboard
│   │   └── api/analytics/
│   │       ├── kpi/                 # KPI-итоги
│   │       ├── by-kind/             # распределение по типам занятий
│   │       ├── by-lesson-form/      # распределение по формам занятий
│   │       ├── by-month-by-kind/    # события по месяцам × типам
│   │       ├── timeline/            # бакеты по неделям/дням
│   │       ├── heatmap/             # тепловая карта 7×24
│   │       ├── top-teachers/        # топ преподавателей
│   │       ├── top-rooms/           # топ аудиторий
│   │       ├── teachers/            # список преподавателей (фильтры, пагинация)
│   │       ├── rooms/               # список аудиторий (фильтры, пагинация)
│   │       ├── teacher/[id]/        # детали преподавателя (вкл. должности)
│   │       ├── room/[id]/           # детали аудитории
│   │       ├── meta/                # периоды, типы, формы (опции фильтров)
│   │       ├── addresses/           # справочник адресов
│   │       └── top-level-units/     # подразделения 1-го уровня
│   ├── components/
│   │   ├── ui/                      # shadcn/ui компоненты
│   │   └── dashboard/
│   │       ├── dashboard.tsx        # shell (хедер + табы + футер)
│   │       ├── filters-bar.tsx      # периоды, формы, тип, отменённые
│   │       ├── multi-select-filter.tsx  # общий мультивыбор (периоды/формы/адреса)
│   │       ├── overview-tab.tsx     # KPI + графики + heatmap
│   │       ├── teachers-tab.tsx     # рейтинг преподавателей (+ фильтр подразделения)
│   │       ├── rooms-tab.tsx        # рейтинг аудиторий (+ фильтр адреса)
│   │       ├── teacher-detail.tsx   # диалог преподавателя (должности, KPI, графики)
│   │       ├── room-detail.tsx      # диалог аудитории
│   │       ├── charts.tsx           # AreaChart, BarChart (в т.ч. horizontal), Pie, Heatmap
│   │       ├── kpi-card.tsx         # карточка KPI
│   │       └── palette.ts           # палитра и подписи
│   └── lib/
│       ├── db.ts                    # PrismaClient (+ опциональное логирование запросов)
│       ├── analytics.ts             # все расчёты аналитики (raw SQL GROUP BY)
│       ├── timing.ts                # пошаговое логирование времени
│       ├── dashboard-store.ts       # Zustand: фильтры + выбранный преподаватель/аудитория
│       └── api-hooks.ts             # TanStack Query хуки (типизированные)
├── .env                             # DATABASE_URL=...
├── db_schema.md                     # экспорт структуры БД (генерируется)
└── README.md
```

---

## API дашборда

Базовые query-параметры (принимают все эндпоинты аналитики):

| Параметр | Тип | Описание |
|----------|-----|----------|
| `dateRangeIds` | `1,3` | Периоды из `DateRange` (мультивыбор; пусто = все) |
| `lessonFormIds` | `1,4` | Формы занятий (мультивыбор; пусто = все) |
| `kindCode` | `0\|1\|2\|3\|all` | Тип занятия |
| `includeCanceled` | `true\|false` | Включать ли отменённые (по умолчанию `false`) |

### Эндпоинты

| Метод | Путь | Описание |
|-------|------|---------|
| GET | `/api/analytics/kpi` | KPI-итоги выборки |
| GET | `/api/analytics/by-kind` | События по типам занятий |
| GET | `/api/analytics/by-lesson-form` | События по формам занятий |
| GET | `/api/analytics/by-month-by-kind` | События по месяцам × типам |
| GET | `/api/analytics/timeline?granularity=week\|day` | Динамика по неделям/дням |
| GET | `/api/analytics/heatmap` | Тепловая карта 7×24 (день недели × час) |
| GET | `/api/analytics/top-teachers?limit=` | Топ преподавателей по эффективной нагрузке |
| GET | `/api/analytics/top-rooms?limit=` | Топ аудиторий по загрузке |
| GET | `/api/analytics/teachers?sort=&search=&page=&pageSize=` | Список преподавателей (`sort`: `effectiveHours` \| `scheduledHours` \| `eventsCount` \| `simultaneousGroups` \| `simultaneousEvents` \| `name`; + `topLevelUnitId=`) |
| GET | `/api/analytics/rooms?sort=&search=&page=&pageSize=` | Список аудиторий (`sort`: `hours` \| `events` \| `uniqueLectures` \| `conflicts` \| `name`; + `addressIds=`) |
| GET | `/api/analytics/teacher/[id]` | Детали преподавателя: KPI, должности, графики, последние занятия |
| GET | `/api/analytics/room/[id]` | Детали аудитории: KPI, конфликты, графики, лекции |
| GET | `/api/analytics/meta` | Периоды, типы, формы занятий (опции фильтров) |
| GET | `/api/analytics/addresses` | Справочник адресов с числом аудиторий |
| GET | `/api/analytics/top-level-units` | Подразделения 1-го уровня с числом преподавателей |

Пример:

```bash
curl "http://localhost:3000/api/analytics/teachers?includeCanceled=false&topLevelUnitId=1&sort=effectiveHours&page=1&pageSize=20"
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

Цепочка всё же может объединять back-to-back события, если они оба
пересекаются с каким-то третьим событием: преподаватель не может вести A, B и C
одновременно, поэтому все три попадают в одну цепочку.

### Дедупликация аудиторий (lectureHash)

Один и тот же поток-лекция появляется в JSON-файлах всех преподавателей, кто её
ведёт (соавторов), и для каждой группы студентов. Хэш `lectureHash` строится из
`subject + start + end + sorted(locations) + sorted(educators)` (без групп),
поэтому все строки одной физической лекции сливаются в **один уникальный слот**
для подсчёта загрузки аудитории — совместное ведение и потоки не создают
ложных конфликтов.

### Конфликты аудиторий

Перекрытия во времени между **разными** `lectureHash` в одной аудитории.
Back-to-back лекции (одна заканчивается в 14:00, следующая начинается в 14:00)
**не считаются конфликтом**.

### Производительность

Тяжёлые расчёты выполняются как raw-SQL агрегации (`GROUP BY` + `MIN/MAX`)
вместо загрузки всех событий в JS: на 400k+ событий это даёт 3–10×
ускорение. См. также `connection_limit=1` и `PRAGMA cache_size`
в `src/lib/db.ts`.

---

## Устранение неполадок

| Симптом | Решение |
|---------|---------|
| `Cannot find module '@prisma/client'` | `bun run db:generate` |
| `Unknown field …` после изменения схемы | перезапустить dev-сервер |
| Ошибка `We found changes that cannot be executed` при `db:push` | `bun run db:push --accept-data-loss` (проверьте, что теряете только лишнее) |
| Импорт пишет `0 events so far` | проверьте, что папка содержит `.json`-файлы нужного формата (`EducatorMasterId`, `EducatorEventsDays`) |
| Дашборд показывает `Нет данных` | запустите импорт и убедитесь, что `db/custom.db` создан |
| Сервер не стартует: `Unable to acquire lock at .next/dev/lock` | остановите другой экземпляр `next dev` |
| Диагностика медленных запросов | `DB_LOG_SLOW_MS=0 ANALYTICS_LOG_SLOW_MS=0 bun run dev` |

---

## Развёртывание на сервере (production)

Инструкция предполагает, что на сервере уже установлен **Bun 1.3+** и **git**.

### 0. Проверка окружения

```bash
bun --version    # должно быть 1.3.x или выше
git --version
```

Если Bun не установлен:

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### 1. Клонирование и установка

```bash
git clone <repo-url> schedule-analytics
cd schedule-analytics
bun install
```

### 2. Переменные окружения

```bash
# Абсолютный путь к SQLite-файлу (рекомендуется)
DATABASE_URL=file:/var/lib/schedule-analytics/custom.db
```

```bash
sudo mkdir -p /var/lib/schedule-analytics
sudo chown -R $USER:$USER /var/lib/schedule-analytics
```

### 3. Инициализация базы данных

```bash
bun run db:generate
bun run db:push
```

### 4. Импорт данных

```bash
bun run scripts/import-schedules.ts /var/lib/schedule-analytics/timetable
bun run scripts/import-staff.ts /var/lib/schedule-analytics/staff
bun run scripts/import-employees.ts /var/lib/schedule-analytics/employees.json
```

> ⚠️ Импорты **не очищают базу**: повторный запуск пропускает дубликаты
> и дозаполняет новые поля. Для полной очистки — `db:push --force-reset`.

### 5. Сборка production-бандла

```bash
bun run build   # → .next/standalone/ (+ static и public)
```

### 6. Запуск production-сервера

```bash
export NODE_ENV=production
export DATABASE_URL=file:/var/lib/schedule-analytics/custom.db
bun .next/standalone/server.js   # порт 3000
```

### 7. Запуск как сервис (systemd)

```bash
sudo tee /etc/systemd/system/schedule-analytics.service << 'EOF'
[Unit]
Description=Schedule Analytics Dashboard
After=network.target

[Service]
Type=simple
User=<your-username>
WorkingDirectory=/opt/schedule-analytics
Environment=NODE_ENV=production
Environment=DATABASE_URL=file:/var/lib/schedule-analytics/custom.db
Environment=PORT=3000
ExecStart=/home/<your-username>/.bun/bin/bun /opt/schedule-analytics/.next/standalone/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now schedule-analytics
```

Логи: `sudo journalctl -u schedule-analytics -f`.

### 8. Reverse proxy (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name analytics.example.com;

    ssl_certificate /etc/letsencrypt/live/analytics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

TLS-сертификат: `sudo certbot --nginx -d analytics.example.com`.

### 9. Обновление приложения

```bash
cd /opt/schedule-analytics
git pull origin main
bun install
bun run db:generate
bun run db:push   # безопасно — только добавляет таблицы/поля
bun run build
sudo systemctl restart schedule-analytics
```

### 10. Обновление данных

Дашборд читает БД в реальном времени — перезапускать сервер не обязательно.
Импорты идемпотентны (дубликаты пропускаются, новые поля дозаполняются):

```bash
bun run scripts/import-schedules.ts /var/lib/schedule-analytics/timetable
bun run scripts/import-staff.ts /var/lib/schedule-analytics/staff
bun run scripts/import-employees.ts /var/lib/schedule-analytics/employees.json
```

Рекомендуется выполнять импорты при низкой нагрузке: они работают в одной
транзакции и конкурируют с веб-сервером за запись в SQLite.

### 11. Резервное копирование

```bash
# Согласованная копия через .backup:
sqlite3 /var/lib/schedule-analytics/custom.db ".backup /backup/custom-$(date +%Y%m%d).db"

# Cron на ежедневный бэкап (3:00 ночи):
0 3 * * * sqlite3 /var/lib/schedule-analytics/custom.db ".backup /backup/custom-$(date +\%Y\%m\%d).db" && find /backup -name "custom-*.db" -mtime +30 -delete
```

### Docker (альтернатива)

```dockerfile
FROM oven/bun:1.3
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run db:generate && bun run build
EXPOSE 3000
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/custom.db
CMD ["bun", ".next/standalone/server.js"]
```

```bash
docker build -t schedule-analytics .
docker run -d --name schedule-analytics -p 3000:3000 \
  -v /var/lib/schedule-analytics:/data \
  -v /var/lib/schedule-analytics/timetable:/app/upload/timetable \
  schedule-analytics
```

---

## Лицензия

Учебный/внутренний проект. Используйте свободно.
