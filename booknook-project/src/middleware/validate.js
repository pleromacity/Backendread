const VALID_STATUSES = ['To Read', 'Reading', 'Finished'];

function validateBook(req, res, next) {
  const { Title, Author, Status, Rating } = req.body;

  if (!Title || typeof Title !== 'string' || Title.trim().length === 0) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (Title.trim().length > 200) {
    return res.status(400).json({ error: 'Title must be 200 characters or fewer' });
  }
  if (!Author || typeof Author !== 'string' || Author.trim().length === 0) {
    return res.status(400).json({ error: 'Author is required' });
  }
  if (Author.trim().length > 100) {
    return res.status(400).json({ error: 'Author must be 100 characters or fewer' });
  }
  if (Status && !VALID_STATUSES.includes(Status)) {
    return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  if (Rating !== undefined && (Rating < 1 || Rating > 5 || !Number.isInteger(Rating))) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }

  next();
}

function validateUpdate(req, res, next) {
  const { Status, Rating, Genre, Notes } = req.body;

  if (Status && !VALID_STATUSES.includes(Status)) {
    return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  if (Rating !== undefined && (Rating < 1 || Rating > 5 || !Number.isInteger(Rating))) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }
  if (Genre && typeof Genre !== 'string') {
    return res.status(400).json({ error: 'Genre must be a string' });
  }
  if (Notes && typeof Notes !== 'string') {
    return res.status(400).json({ error: 'Notes must be a string' });
  }

  next();
}

module.exports = { validateBook, validateUpdate };
