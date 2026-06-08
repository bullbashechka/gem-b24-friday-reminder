'use strict';

const pino = require('pino');

// Единый логгер на весь проект. Пишет JSON в stdout —
// в файл и ротацию делает cron (>> logs/app.log) + logrotate.
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

module.exports = logger;
