'use strict';

const axios = require('axios');
const logger = require('./logger');

// Нормализуем базовый URL вебхука: ровно один завершающий слэш.
function getBaseUrl() {
  const raw = process.env.WEBHOOK_URL;
  if (!raw || !raw.trim()) {
    throw new Error('WEBHOOK_URL не задан. Заполни .env (см. .env.example).');
  }
  return raw.trim().replace(/\/+$/, '') + '/';
}

/**
 * Вызвать REST-метод Битрикс24.
 * POST на ${WEBHOOK_URL}${method}.json с телом params.
 * Возвращает полный объект ответа Битрикса ({ result, total, next, ... }).
 */
async function call(method, params = {}) {
  const url = `${getBaseUrl()}${method}.json`;
  const startedAt = Date.now();

  let response;
  try {
    response = await axios.post(url, params, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  } catch (err) {
    const ms = Date.now() - startedAt;
    // Битрикс мог вернуть тело ошибки даже при не-2xx статусе.
    const data = err.response && err.response.data;
    const description =
      (data && (data.error_description || data.error)) || err.message;
    logger.error(
      { method, ms, status: err.response && err.response.status },
      `Bitrix call failed: ${description}`
    );
    throw new Error(`Bitrix "${method}" failed: ${description}`);
  }

  const ms = Date.now() - startedAt;
  const data = response.data || {};

  if (data.error) {
    logger.error(
      { method, ms, error: data.error },
      `Bitrix error: ${data.error_description || data.error}`
    );
    throw new Error(
      `Bitrix "${method}" error: ${data.error_description || data.error}`
    );
  }

  logger.debug({ method, ms }, 'Bitrix call ok');
  return data;
}

/**
 * Пройти все страницы списочного метода Битрикса.
 * Битрикс отдаёт по 50 записей и поле `next` — смещение следующей страницы.
 * Возвращает плоский массив всех элементов из data.result.
 *
 * resultKey — если result это объект ({ tasks: [...] }), указать ключ массива.
 */
async function callList(method, params = {}, resultKey = null) {
  const items = [];
  let start = 0;

  // Защита от бесконечного цикла на случай странного ответа.
  for (let page = 0; page < 1000; page += 1) {
    const data = await call(method, { ...params, start });
    const result = data.result;
    const chunk = resultKey ? (result && result[resultKey]) || [] : result || [];
    items.push(...chunk);

    if (data.next === undefined || data.next === null) break;
    start = data.next;
  }

  return items;
}

module.exports = { call, callList, getBaseUrl };

// Самодостаточный запуск: проверка вебхука через profile.
if (require.main === module) {
  require('dotenv').config();
  call('profile')
    .then((data) => {
      logger.info({ profile: data.result }, 'Webhook OK');
    })
    .catch((err) => {
      logger.error(err.message);
      process.exit(1);
    });
}
