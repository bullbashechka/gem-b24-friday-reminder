'use strict';

require('dotenv').config();

const logger = require('./logger');
const { getTodayDeadlineUsers } = require('./tasks');
const { sendReminder } = require('./messages');

const SEND_DELAY_MS = 500; // лимит Битрикса ~2 req/sec

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!process.env.WEBHOOK_URL || !process.env.WEBHOOK_URL.trim()) {
    logger.error('WEBHOOK_URL не задан. Заполни .env (см. .env.example).');
    process.exit(1);
  }

  const timeZone = process.env.TIMEZONE || 'UTC';
  const startedAt = Date.now();

  // Сбор исполнителей — фатальная ошибка валит прогон.
  let counts;
  try {
    counts = await getTodayDeadlineUsers(timeZone);
  } catch (err) {
    logger.error({ err: err.message }, 'Не удалось получить задачи — прогон прерван');
    process.exit(1);
  }

  if (counts.size === 0) {
    logger.info('Нет исполнителей с задачами на сегодня — рассылать нечего.');
    return;
  }

  let sent = 0;
  let failed = 0;
  let tasksTotal = 0;
  let first = true;

  for (const [uid, count] of counts) {
    tasksTotal += count;
    if (!first) await sleep(SEND_DELAY_MS);
    first = false;

    try {
      await sendReminder(uid);
      sent += 1;
    } catch (err) {
      // Ошибка отправки одному не должна валить остальных.
      failed += 1;
      logger.error({ uid, tasks: count }, `Не удалось отправить: ${err.message}`);
    }
  }

  logger.info(
    {
      users: counts.size,
      sent,
      failed,
      tasksTotal,
      durationMs: Date.now() - startedAt,
    },
    'Прогон завершён'
  );
}

main().catch((err) => {
  logger.error({ err: err.message }, 'Фатальная ошибка');
  process.exit(1);
});
