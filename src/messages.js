'use strict';

const { call } = require('./bitrix');
const logger = require('./logger');

const CHECKLIST = [
  'Привет! Пятница, перед концом дня нужно:',
  '',
  '☐ Сдвинуть задачи с дедлайном на сегодня + комментарий по каждой',
  '☐ Закрыть открытые обращения в Коннекте',
  '☐ К обращениям «в работе» — привязать задачу',
  '',
  'Напомню через час, если задачи на сегодня ещё останутся.',
].join('\n');

function isDryRun() {
  const v = (process.env.DRY_RUN || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Отправить напоминание сотруднику.
 * Учитывает тест-режимы:
 *  - TEST_USER_ID: все сообщения уходят на этот ID (себе);
 *  - DRY_RUN: ничего не отправляем, только логируем.
 * Возвращает { sent: boolean, dialogId: string }.
 */
async function sendReminder(userId, message = CHECKLIST) {
  const testUser = (process.env.TEST_USER_ID || '').trim();
  const dialogId = testUser || String(userId);

  if (isDryRun()) {
    logger.info(
      { dialogId, originalUserId: String(userId), dryRun: true },
      'DRY_RUN: сообщение НЕ отправлено'
    );
    return { sent: false, dialogId };
  }

  // Отправка от имени пользователя вебхука (тех.юзер «Контроль пятницы»).
  await call('im.message.add', {
    DIALOG_ID: dialogId,
    MESSAGE: message,
    SYSTEM: 'N',
    URL_PREVIEW: 'N',
  });

  if (testUser) {
    logger.info(
      { dialogId, originalUserId: String(userId) },
      'Отправлено (TEST_USER_ID — перенаправлено)'
    );
  } else {
    logger.info({ dialogId }, 'Отправлено');
  }
  return { sent: true, dialogId };
}

module.exports = { sendReminder, CHECKLIST };

// Самодостаточный запуск: тестовая отправка себе.
// Использование: TEST_USER_ID=<id> node src/messages.js
if (require.main === module) {
  require('dotenv').config();
  const target = (process.env.TEST_USER_ID || '').trim();
  if (!target) {
    logger.error('Укажи TEST_USER_ID в .env для тестовой отправки себе.');
    process.exit(1);
  }
  sendReminder(target, 'Тест Friday reminder')
    .then(() => logger.info('Готово.'))
    .catch((err) => {
      logger.error(err.message);
      process.exit(1);
    });
}
