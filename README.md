# b24-friday-reminder

Бот-напоминалка для Битрикс24. По пятницам раз в час (cron) находит сотрудников с задачами, у которых дедлайн сегодня и статус не закрыт, и шлёт каждому личное сообщение с чек-листом дел перед концом недели.

Без состояния между запусками: один запуск = один прогон. Повторение раз в час делает системный cron, а не скрипт.

## Стек

- Node.js 20 LTS
- `axios`, `dotenv`, `pino`
- Системный cron + `logrotate` (на VPS)

## Структура

```
src/
  index.js     # точка входа: сбор → рассылка → статистика
  bitrix.js    # REST-обёртка call() + пагинация callList()
  tasks.js     # getTodayDeadlineUsers() + границы дня по таймзоне
  messages.js  # текст чек-листа + sendReminder()
  logger.js    # общий pino-логгер
logs/          # логи (в .gitignore)
.env           # секреты (в .gitignore)
.env.example
```

## Развёртывание с нуля

### 1. Вебхук в Битрикс24

1. Создать отдельного пользователя «Контроль пятницы» и войти под ним — от его имени будут уходить сообщения (не от личного аккаунта).
2. `Приложения` → `Разработчикам` → `Другое` → `Входящий вебхук`.
3. Права: `task` (читать `tasks.task.list`) и `im` (слать `im.message.add`).
4. Скопировать URL вида `https://portal.bitrix24.ru/rest/USER_ID/WEBHOOK_CODE/`.

> URL вебхука — секрет. Не коммитить, не пересылать в чатах, не класть в README.

### 2. Проект

```bash
mkdir -p /opt/b24-friday-reminder && cd /opt/b24-friday-reminder
git clone <repo> .            # или git init + загрузка кода
npm install
cp .env.example .env          # вписать WEBHOOK_URL, TIMEZONE, LOG_PATH
```

### 3. Проверка

```bash
node src/bitrix.js                          # profile — вебхук живой
node src/tasks.js                           # список uid + кол-во задач на сегодня
DRY_RUN=1 node src/index.js                 # кому ушло бы, без отправки
TEST_USER_ID=<свой_id> node src/index.js    # все сообщения только себе
node src/index.js                           # боевой прогон
```

### 4. Cron

Расписание: пятница 09:30 один раз, затем каждый час 17:00–23:00. Часы указаны в **UTC** (−5 от Asia/Yekaterinburg):

```cron
30 4 * * 5     cd /opt/b24-friday-reminder && /usr/bin/node src/index.js >> logs/app.log 2>&1
0 12-18 * * 5  cd /opt/b24-friday-reminder && /usr/bin/node src/index.js >> logs/app.log 2>&1
```

> Указывать **полный путь** к node — в cron другой PATH. Узнать: `which node`.
> Часы в UTC: `4:30 = 09:30`, `12–18 = 17:00–23:00` по UTC+5. Если сервер не в UTC, пересчитать (`timedatectl`). Скрипт считает «сегодня» по `TIMEZONE` из `.env`, не по системной зоне.

### 5. Ротация логов

`/etc/logrotate.d/b24-friday-reminder`:

```
/opt/b24-friday-reminder/logs/app.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
}
```

Проверка: `logrotate -d /etc/logrotate.d/b24-friday-reminder`

## Конфиг `.env`

| Переменная     | Назначение                                                       |
|----------------|-----------------------------------------------------------------|
| `WEBHOOK_URL`  | URL входящего вебхука Битрикс24 (секрет)                         |
| `TIMEZONE`     | IANA-зона портала, напр. `Asia/Almaty` — по ней границы дня      |
| `LOG_PATH`     | Путь к лог-файлу (справочно; запись делает cron через `>>`)      |
| `DRY_RUN`      | `1` — логировать адресатов без реальной отправки                 |
| `TEST_USER_ID` | если задан — все сообщения уходят только на этот ID (себе)       |

## Как менять текст сообщения

Константа `CHECKLIST` в [src/messages.js](src/messages.js).

## Как смотреть логи

```bash
tail -f logs/app.log
```

Логи в формате JSON (pino). Для читаемого вывода локально: `node src/index.js | npx pino-pretty`.

## Как временно отключить

Закомментировать строку в `crontab -e`:

```cron
# 0 9-18 * * 5  cd /opt/b24-friday-reminder && /usr/bin/node src/index.js >> logs/app.log 2>&1
```
