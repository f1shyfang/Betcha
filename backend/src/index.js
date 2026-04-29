const db = require('./db');
const { createApp } = require('./app');
const { getIdempotentResponse, storeIdempotentResponse } = require('./idempotency');

const app = createApp({
  db,
  getIdempotentResponse,
  storeIdempotentResponse
});

if (require.main === module) {
  app.listen(process.env.PORT || 3001, () => console.log('Backend prototype listening on 3001'));
}

module.exports = { app };
