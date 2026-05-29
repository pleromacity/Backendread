require('dotenv').config();
const app = require('./app');
const { initDb } = require('./config/db');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initDb();
    console.log('Database initialised');

    app.listen(PORT, () => {
      console.log(`BookNook API running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
