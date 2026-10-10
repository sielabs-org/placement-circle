'use strict';
const config = require('./config');
const { createApp } = require('./app');
const seed = require('./seed');

const result = seed.run(); // fills empty tables with starter content; creates admin if configured
if (Object.keys(result.added).length) console.log('Seeded starter content:', JSON.stringify(result.added));

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`\nPlacement Circle is running  ->  http://localhost:${config.port}`);
  console.log(`API health check             ->  http://localhost:${config.port}/api/health`);
  console.log('');
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
