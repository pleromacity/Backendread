const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const { requestLogger } = require('./middleware/logger');

const booksRouter = require('./routes/books');
const uploadRouter = require('./routes/upload');
const healthRouter = require('./routes/health');

const app = express();

// Security headers
app.use(helmet());

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP request logging (goes to App Service log stream)
app.use(morgan('combined'));
app.use(requestLogger);

// Routes
app.use('/health', healthRouter);
app.use('/api/books', booksRouter);
app.use('/api/books', uploadRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
  });
});

module.exports = app;
