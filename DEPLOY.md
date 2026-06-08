# Деплой на VPS (без SSH-ключей)

Инструкция по развёртыванию `b24-friday-reminder` на Linux-VPS. SSH-ключи не создаём — подключаемся к серверу так, как уже умеем: по паролю (`ssh root@IP` → ввод пароля) или через веб-консоль хостинга (VNC/«Консоль» в панели Timeweb/Beget/Reg.ru/и т.п.). Все команды ниже выполняются **на сервере**.

> Предполагается Ubuntu/Debian. Для других дистрибутивов отличается только установка Node и пакетный менеджер.
>
> Шаги 1–5 делаются **от root** (или через `sudo`). Шаги 6–9 — **от пользователя проекта** `b24bot`. Где это важно, помечено.

---

## 1. Подключиться к серверу (root)

По паролю из терминала (Git Bash / PowerShell на твоём ПК):

```bash
ssh root@ТВОЙ_IP
# ввести пароль, который дал хостинг
```

Либо открой «Консоль» в панели управления хостингом — это тот же терминал, без всякого SSH.

---

## 2. Обновить систему (root)

```bash
apt-get update && apt-get upgrade -y
```

Если в процессе попросит перезагрузку — `reboot`, потом зайти заново.

---

## 3. Создать пользователя для проекта (root)

Запускать бота от `root` не нужно — заведём отдельного пользователя `b24bot`:

```bash
adduser --disabled-password --gecos "" b24bot
```

(`--disabled-password` — без пароля; заходить под ним будем через `su`, отдельный вход по SSH ему не нужен.)

---

## 4. Установить Node.js 20 LTS (root)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
node -v   # должно быть v20.x
```

---

## 5. Подготовить папку проекта (root)

```bash
mkdir -p /opt/b24-friday-reminder
chown -R b24bot:b24bot /opt/b24-friday-reminder
```

---

## 6. Залить код (от b24bot)

Переключиться на пользователя проекта:

```bash
su - b24bot
cd /opt/b24-friday-reminder
```

Репозиторий приватный на GitHub. Используем **Deploy Key** — ключ на уровне самого репо, read-only, не аккаунтный токен. Это git-only SSH-ключ для одного репозитория (не доступ к серверу).

**1. На сервере (под b24bot) сгенерировать ключ:**

```bash
ssh-keygen -t ed25519 -C "b24bot deploy key" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Скопировать всю строку (`ssh-ed25519 AAAA...`).

**2. В GitHub добавить ключ в репо:** репозиторий → `Settings` → `Deploy keys` → `Add deploy key`. Title `vps b24bot`, Key — вставить скопированное, `Allow write access` **не ставить**, `Add key`.

**3. Клонировать по SSH-URL:**

```bash
cd /opt/b24-friday-reminder
git clone git@github.com:ТВОЙ_АККАУНТ/gem-b24-friday-reminder.git .
# при первом подключении подтвердить отпечаток github.com: yes
```

`git pull` дальше работает без паролей — ключ уже на месте.

> Альтернатива без всяких ключей: загрузить файлы через файловый менеджер панели хостинга или по SFTP (FileZilla, по паролю). Залить всё, **кроме** `node_modules/`, `logs/` и `.env`. После загрузки от root: `chown -R b24bot:b24bot /opt/b24-friday-reminder`.

---

## 7. Зависимости, `.env`, папка логов (от b24bot)

```bash
cd /opt/b24-friday-reminder
npm install --omit=dev
mkdir -p logs            # папка в .gitignore, её может не быть
nano .env
```

В `.env` вставить (подставить свой действующий вебхук):

```
WEBHOOK_URL=https://toofirmagem.bitrix24.kz/rest/30/ТВОЙ_КОД/
TIMEZONE=Asia/Yekaterinburg
LOG_PATH=/opt/b24-friday-reminder/logs/app.log
DRY_RUN=
TEST_USER_ID=
```

Сохранить в nano: `Ctrl+O`, `Enter`, `Ctrl+X`.

> `TEST_USER_ID` пустой = боевой режим, шлём всем с задачами на сегодня.
> Хочешь сначала проверить на себе — поставь `TEST_USER_ID=30`.

---

## 8. Проверить вручную (от b24bot)

```bash
cd /opt/b24-friday-reminder
node src/bitrix.js                  # вебхук живой (profile)
DRY_RUN=1 node src/index.js         # предпросмотр адресатов, без отправки
```

Если предпросмотр показал нужных людей — боевой прогон:

```bash
node src/index.js
```

Узнать полный путь к node (нужен для cron — там другой `PATH`):

```bash
which node      # напр. /usr/bin/node — запомни результат
```

---

## 9. Настроить cron (от b24bot)

Crontab заводим **под пользователем b24bot**, чтобы задача шла от него:

```bash
crontab -e
```

Добавить **две строки** (подставить путь из шага 8). Расписание: пятница 09:30 один раз, затем каждый час с 17:00 до 23:00.

```cron
30 4 * * 5     cd /opt/b24-friday-reminder && /usr/bin/node src/index.js >> logs/app.log 2>&1
0 12-18 * * 5  cd /opt/b24-friday-reminder && /usr/bin/node src/index.js >> logs/app.log 2>&1
```

> ⚠️ Время cron — по таймзоне сервера, а сервер в **UTC**, поэтому часы сдвинуты на −5: `4:30 UTC = 09:30`, `12–18 UTC = 17:00–23:00` по Екатеринбургу/Алматы (UTC+5). На отбор задач это не влияет — «сегодня» скрипт считает по `TIMEZONE` из `.env`. Если сервер не в UTC — пересчитай часы под его зону (`timedatectl`). Верхнюю границу (`18` = 23:00) можно менять.

Проверить, что записалось: `crontab -l`

### Быстрый тест cron (не дожидаясь пятницы)

Временно добавь строку на «через минуту» (поставь ближайшую минуту вместо `M`):

```cron
M * * * *  cd /opt/b24-friday-reminder && /usr/bin/node src/index.js >> logs/app.log 2>&1
```

Через минуту проверь лог (шаг 11), затем убери строку.

---

## 10. Ротация логов (root)

Выйти из-под b24bot обратно в root: `exit`. Затем:

```bash
nano /etc/logrotate.d/b24-friday-reminder
```

Вставить:

```
/opt/b24-friday-reminder/logs/app.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    su b24bot b24bot
}
```

Проверка конфига:

```bash
logrotate -d /etc/logrotate.d/b24-friday-reminder
```

---

## 11. Как смотреть логи

```bash
tail -f /opt/b24-friday-reminder/logs/app.log
```

Логи в JSON. Ключевая строка прогона — `Прогон завершён` с полями `users`, `sent`, `failed`.

---

## 12. Обновление кода в будущем (от b24bot)

```bash
su - b24bot
cd /opt/b24-friday-reminder
git pull
npm install --omit=dev
```

`.env` при обновлении не трогается — он не в репозитории.

---

## 13. Как временно отключить (от b24bot)

```bash
su - b24bot
crontab -e
```

Закомментировать строку, поставив `#` в начале:

```cron
# 0 9-18 * * 5  cd /opt/b24-friday-reminder && /usr/bin/node src/index.js >> logs/app.log 2>&1
```
