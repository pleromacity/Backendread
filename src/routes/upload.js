const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getContainerClient } = require('../config/storage');
const { getPool, sql } = require('../config/db');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// Store files in memory so we can stream straight to Blob Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG and WebP images are accepted'));
    }
  },
});

// ── POST /api/books/:id/cover ─────────────────────────────────────────────────
router.post('/:id/cover', upload.single('cover'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Use field name "cover".' });
    }

    const pool = await getPool();

    // Verify book exists
    const existing = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT Id FROM Books WHERE Id = @id');
    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }

    // Upload to Blob Storage
    const ext = path.extname(req.file.originalname) || '.jpg';
    const blobName = `${req.params.id}-${uuidv4()}${ext}`;
    const container = await getContainerClient();
    const blockBlob = container.getBlockBlobClient(blobName);

    await blockBlob.uploadData(req.file.buffer, {
      blobHTTPHeaders: { blobContentType: req.file.mimetype },
    });

    const coverUrl = blockBlob.url;

    // Persist URL to the database
    await pool.request()
      .input('id',       sql.Int,      req.params.id)
      .input('coverUrl', sql.NVarChar, coverUrl)
      .query('UPDATE Books SET CoverUrl = @coverUrl WHERE Id = @id');

    res.json({ coverUrl });
  } catch (err) {
    // multer file-too-large error
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File must be under 5 MB' });
    }
    next(err);
  }
});

module.exports = router;
