const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');
const { validateBook, validateUpdate } = require('../middleware/validate');

const VALID_STATUSES = ['To Read', 'Reading', 'Finished'];

// ── GET /api/books ────────────────────────────────────────────────────────────
// Optional query params: ?status=Reading  ?genre=Fantasy
router.get('/', async (req, res, next) => {
  try {
    const pool = await getPool();
    const request = pool.request();
    let query = 'SELECT * FROM Books WHERE 1=1';

    if (req.query.status) {
      request.input('status', sql.NVarChar, req.query.status);
      query += ' AND Status = @status';
    }
    if (req.query.genre) {
      request.input('genre', sql.NVarChar, req.query.genre);
      query += ' AND Genre = @genre';
    }

    query += ' ORDER BY AddedAt DESC';
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/books/:id ────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM Books WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/books ───────────────────────────────────────────────────────────
router.post('/', validateBook, async (req, res, next) => {
  try {
    const { Title, Author, Genre = 'Fiction', Status = 'To Read', Notes = '' } = req.body;
    const pool = await getPool();
    const result = await pool.request()
      .input('title',  sql.NVarChar, Title)
      .input('author', sql.NVarChar, Author)
      .input('genre',  sql.NVarChar, Genre)
      .input('status', sql.NVarChar, Status)
      .input('notes',  sql.NVarChar, Notes)
      .query(`
        INSERT INTO Books (Title, Author, Genre, Status, Notes)
        OUTPUT INSERTED.*
        VALUES (@title, @author, @genre, @status, @notes)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/books/:id ──────────────────────────────────────────────────────
router.patch('/:id', validateUpdate, async (req, res, next) => {
  try {
    const pool = await getPool();

    // Check book exists
    const existing = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM Books WHERE Id = @id');
    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }

    const { Status, Rating, Notes, Genre } = req.body;
    const book = existing.recordset[0];

    // Validate status transition
    if (Status && !VALID_STATUSES.includes(Status)) {
      return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    // Rating only makes sense when Finished
    const newStatus = Status || book.Status;
    if (Rating && newStatus !== 'Finished') {
      return res.status(400).json({ error: 'Rating can only be set when Status is Finished' });
    }

    const result = await pool.request()
      .input('id',     sql.Int,      req.params.id)
      .input('status', sql.NVarChar, Status  ?? book.Status)
      .input('rating', sql.Int,      Rating  ?? book.Rating)
      .input('notes',  sql.NVarChar, Notes   ?? book.Notes)
      .input('genre',  sql.NVarChar, Genre   ?? book.Genre)
      .query(`
        UPDATE Books
        SET Status = @status, Rating = @rating, Notes = @notes, Genre = @genre
        OUTPUT INSERTED.*
        WHERE Id = @id
      `);

    res.json(result.recordset[0]);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/books/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('DELETE FROM Books OUTPUT DELETED.Id WHERE Id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
