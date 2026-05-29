const sql = require('mssql');

let pool = null;

/**
 * Build the mssql config from the connection string stored in Key Vault.
 * The App Service retrieves it via a Key Vault reference in the app setting
 * AZURE_SQL_CONNECTIONSTRING.  Locally, put it in your .env file.
 *
 * Expected format (ADO.NET style):
 *   Server=tcp:<server>.database.windows.net,1433;Database=<db>;
 *   Authentication=Active Directory Default;Encrypt=True;
 */
function getSqlConfig() {
  const connStr = process.env.AZURE_SQL_CONNECTIONSTRING;
  if (connStr) {
    // Parse the ADO.NET connection string
    const parts = Object.fromEntries(
      connStr.split(';')
        .filter(Boolean)
        .map(part => {
          const idx = part.indexOf('=');
          return [part.slice(0, idx).trim().toLowerCase(), part.slice(idx + 1).trim()];
        })
    );
    return {
      server: parts['server']?.replace(/^tcp:/, '').split(',')[0],
      database: parts['database'] || parts['initial catalog'],
      options: {
        encrypt: true,
        trustServerCertificate: false,
        enableArithAbort: true,
      },
      authentication: {
        type: 'azure-active-directory-default',
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };
  }

  // Local development fallback using SQL auth env vars
  return {
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

async function getPool() {
  if (pool) return pool;
  pool = await sql.connect(getSqlConfig());
  return pool;
}

async function initDb() {
  const p = await getPool();
  await p.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'Books'
    )
    BEGIN
      CREATE TABLE Books (
        Id         INT           PRIMARY KEY IDENTITY(1,1),
        Title      NVARCHAR(200) NOT NULL,
        Author     NVARCHAR(100) NOT NULL,
        Genre      NVARCHAR(50)  DEFAULT 'Fiction',
        Status     NVARCHAR(20)  DEFAULT 'To Read',
        Rating     INT           NULL,
        Notes      NVARCHAR(MAX) DEFAULT '',
        CoverUrl   NVARCHAR(500) DEFAULT '',
        AddedAt    DATETIME2     DEFAULT GETUTCDATE()
      )
    END
  `);
}

module.exports = { getPool, initDb, sql };
