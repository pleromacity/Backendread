/**
 * Smoke tests – run locally with:  npm test
 *
 * These tests mock the database and blob storage so you don't need
 * a live Azure environment to run CI checks.
 */

// ── Mock heavy dependencies before importing app ──────────────────────────────
jest.mock('../src/config/db', () => {
  const mockRecordset = [];
  const mockRequest = {
    input: jest.fn().mockReturnThis(),
    query: jest.fn().mockResolvedValue({ recordset: mockRecordset }),
  };
  return {
    getPool: jest.fn().mockResolvedValue({ request: () => mockRequest }),
    initDb: jest.fn().mockResolvedValue(undefined),
    sql: { Int: 'Int', NVarChar: 'NVarChar' },
    _mockRequest: mockRequest,
    _mockRecordset: mockRecordset,
  };
});

jest.mock('../src/config/storage', () => ({
  getContainerClient: jest.fn().mockResolvedValue({
    getBlockBlobClient: jest.fn().mockReturnValue({
      uploadData: jest.fn().mockResolvedValue({}),
      url: 'https://fakestorage.blob.core.windows.net/covers/test.jpg',
    }),
    createIfNotExists: jest.fn().mockResolvedValue({}),
  }),
}));

const request = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  it('returns 200 when DB is reachable', async () => {
    const db = require('../src/config/db');
    db._mockRequest.query.mockResolvedValueOnce({ recordset: [{ ok: 1 }] });

    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('healthy');
  });
});

describe('POST /api/books', () => {
  it('rejects missing Title', async () => {
    const res = await request(app)
      .post('/api/books')
      .send({ Author: 'Someone' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Title/);
  });

  it('rejects missing Author', async () => {
    const res = await request(app)
      .post('/api/books')
      .send({ Title: 'A Book' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Author/);
  });

  it('accepts a valid book', async () => {
    const db = require('../src/config/db');
    const book = { Id: 1, Title: 'Dune', Author: 'Frank Herbert', Genre: 'Sci-Fi', Status: 'To Read', Rating: null, Notes: '', CoverUrl: '', AddedAt: new Date().toISOString() };
    db._mockRequest.query.mockResolvedValueOnce({ recordset: [book] });

    const res = await request(app)
      .post('/api/books')
      .send({ Title: 'Dune', Author: 'Frank Herbert', Genre: 'Sci-Fi' });
    expect(res.statusCode).toBe(201);
    expect(res.body.Title).toBe('Dune');
  });
});

describe('PATCH /api/books/:id', () => {
  it('rejects invalid status', async () => {
    const res = await request(app)
      .patch('/api/books/1')
      .send({ Status: 'Abandoned' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects rating without Finished status', async () => {
    const db = require('../src/config/db');
    db._mockRequest.query.mockResolvedValueOnce({
      recordset: [{ Id: 1, Status: 'Reading', Rating: null, Notes: '', Genre: 'Fiction' }],
    });
    const res = await request(app)
      .patch('/api/books/1')
      .send({ Rating: 4 });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Finished/);
  });
});
