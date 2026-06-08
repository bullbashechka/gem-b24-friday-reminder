'use strict';

const { callList } = require('./bitrix');
const logger = require('./logger');

// Незакрытые статусы задач Битрикса: 2 — ждёт выполнения,
// 3 — выполняется, 4 — ждёт контроля. Всё остальное (5,6,7) пропускаем.
const OPEN_STATUSES = new Set([2, 3, 4]);

/**
 * Смещение таймзоны в минутах относительно UTC на момент `date`.
 * Считаем через Intl: форматируем время в зоне, трактуем как UTC и
 * сравниваем с реальным UTC. Учитывает переход на летнее время.
 */
function getOffsetMinutes(timeZone, date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

function formatOffset(minutes) {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/**
 * Границы сегодняшнего дня (00:00:00 и 23:59:59) в указанной таймзоне,
 * в формате ISO с офсетом — пригодны для фильтра DEADLINE Битрикса.
 */
function getTodayBounds(timeZone, now = new Date()) {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // en-CA → YYYY-MM-DD

  const offset = formatOffset(getOffsetMinutes(timeZone, now));
  return {
    date: dateParts,
    from: `${dateParts}T00:00:00${offset}`,
    to: `${dateParts}T23:59:59${offset}`,
  };
}

function pick(task, ...keys) {
  for (const key of keys) {
    if (task[key] !== undefined && task[key] !== null) return task[key];
  }
  return undefined;
}

/**
 * Собрать исполнителей задач с дедлайном сегодня и незакрытым статусом.
 * Возвращает Map<uid:string, count:number> — сколько таких задач у каждого.
 */
async function getTodayDeadlineUsers(timeZone = process.env.TIMEZONE || 'UTC') {
  const bounds = getTodayBounds(timeZone);
  logger.info({ date: bounds.date, from: bounds.from, to: bounds.to }, 'Сбор задач с дедлайном сегодня');

  const tasks = await callList(
    'tasks.task.list',
    {
      order: { DEADLINE: 'asc' },
      filter: {
        '>=DEADLINE': bounds.from,
        '<=DEADLINE': bounds.to,
      },
      select: ['ID', 'RESPONSIBLE_ID', 'REAL_STATUS'],
    },
    'tasks'
  );

  const counts = new Map();
  for (const task of tasks) {
    const status = Number(pick(task, 'realStatus', 'REAL_STATUS', 'status', 'STATUS'));
    if (!OPEN_STATUSES.has(status)) continue;

    const uid = String(pick(task, 'responsibleId', 'RESPONSIBLE_ID'));
    if (!uid || uid === 'undefined') continue;

    counts.set(uid, (counts.get(uid) || 0) + 1);
  }

  logger.info(
    { tasksTotal: tasks.length, users: counts.size },
    'Исполнители собраны'
  );
  return counts;
}

module.exports = { getTodayDeadlineUsers, getTodayBounds, getOffsetMinutes, formatOffset };

// Самодостаточный запуск: печать списка исполнителей в консоль.
if (require.main === module) {
  require('dotenv').config();
  getTodayDeadlineUsers()
    .then((counts) => {
      if (counts.size === 0) {
        logger.info('Нет задач с дедлайном сегодня.');
      }
      for (const [uid, count] of counts) {
        logger.info(`uid=${uid} задач=${count}`);
      }
    })
    .catch((err) => {
      logger.error(err.message);
      process.exit(1);
    });
}
