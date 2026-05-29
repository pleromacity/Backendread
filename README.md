# BookNook API 📚

A small REST API for a book-club reading tracker. Members can add books, update their reading status, rate finished books, and upload cover images.

**Stack:** Node.js + Express · Azure SQL Database (serverless) · Azure Blob Storage · Azure Key Vault · Azure App Service · GitHub Actions

---

## Table of Contents

1. [Project structure](#project-structure)
2. [API endpoints](#api-endpoints)
3. [Local development](#local-development)
4. [Provision Azure resources](#provision-azure-resources)
5. [Configure GitHub Actions](#configure-github-actions)
6. [Monitoring & alerts](#monitoring--alerts)
7. [Security notes](#security-notes)
8. [Teardown](#teardown)

---

## Project Structure

```
booknook/
├── src/
│   ├── server.js           # Entry point
│   ├── app.js              # Express app + middleware
│   ├── config/
│   │   ├── db.js           # Azure SQL connection (managed identity)
│   │   └── storage.js      # Blob Storage client (managed identity)
│   ├── routes/
│   │   ├── books.js        # CRUD for books
│   │   ├── upload.js       # Cover image upload
│   │   └── health.js       # Health check
│   └── middleware/
│       ├── validate.js     # Request validation
│       └── logger.js       # Structured JSON logging
├── tests/
│   └── api.test.js         # Jest smoke tests
├── scripts/
│   ├── provision.sh        # One-shot Azure provisioning
│   └── teardown.sh         # Deletes all resources
├── .github/
│   └── workflows/
│       └── deploy.yml      # CI/CD pipeline
├── .env.example
└── package.json
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check – confirms DB connectivity |
| `GET` | `/api/books` | List all books (optional `?status=` `?genre=`) |
| `GET` | `/api/books/:id` | Get a single book |
| `POST` | `/api/books` | Add a new book |
| `PATCH` | `/api/books/:id` | Update status, rating, notes, or genre |
| `DELETE` | `/api/books/:id` | Remove a book |
| `POST` | `/api/books/:id/cover` | Upload a cover image (multipart/form-data, field `cover`) |

### Request / Response examples

**Add a book**
```http
POST /api/books
Content-Type: application/json

{
  "Title": "Dune",
  "Author": "Frank Herbert",
  "Genre": "Sci-Fi"
}
```
```json
{
  "Id": 1,
  "Title": "Dune",
  "Author": "Frank Herbert",
  "Genre": "Sci-Fi",
  "Status": "To Read",
  "Rating": null,
  "Notes": "",
  "CoverUrl": "",
  "AddedAt": "2024-11-01T09:00:00.000Z"
}
```

**Mark as finished and rate it**
```http
PATCH /api/books/1
Content-Type: application/json

{
  "Status": "Finished",
  "Rating": 5,
  "Notes": "One of the best books I've read."
}
```

**Upload a cover**
```bash
curl -X POST https://<app>.azurewebsites.net/api/books/1/cover \
  -F "cover=@dune.jpg"
```

---

## Local Development

### Prerequisites

- Node.js 18+
- Azure CLI (`az login` already done)
- An Azure SQL database you can reach (or use SQL auth locally)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your SQL credentials and storage account name

# 3. Start the dev server (auto-reloads on change)
npm run dev

# 4. Test the health endpoint
curl http://localhost:3000/health
```

---

## Provision Azure Resources

The `provision.sh` script creates every resource in one shot.

> **Before running:** edit the `ALERT_EMAIL` variable at the top of the script.

```bash
chmod +x scripts/provision.sh
./scripts/provision.sh
```

The script creates:

| Resource | Purpose |
|----------|---------|
| Resource Group `booknook-rg` | Container for everything |
| Azure SQL Server + DB | Serverless, auto-pauses after 60 min idle |
| SQL firewall rule | Allows Azure services (App Service, your local IP is NOT added automatically — add it manually if you want to connect from a local tool) |
| Storage Account | Hosts the `covers` blob container (public read) |
| Key Vault | Stores the SQL connection string as a secret |
| App Service Plan (B1 Linux) | Hosts the API |
| Web App (Node 20 LTS) | The running API, HTTPS-only |
| System-assigned managed identity | Lets the app authenticate to SQL, Key Vault, and Blob Storage without passwords |
| RBAC role assignments | Key Vault Secrets User + Storage Blob Data Contributor |
| SQL AD admin | The managed identity is set as the Azure AD admin for the SQL server |
| Log Analytics workspace | Collects HTTP and console logs |
| Diagnostic settings | Streams App Service logs to the workspace |
| HTTP 5xx alert | Fires if >5 server errors occur in 5 minutes |
| Budget | $10/month with email alerts at 80% and 100% |

At the end the script prints your app URL and the auto-generated SQL admin password. **Save the password** — it is not stored anywhere in Azure.

### What the script does NOT do automatically

- Add your **local IP** to the SQL firewall (do this in the Azure portal under the SQL server → Networking if you want to connect from a local DB tool like Azure Data Studio)
- Set the `covers` container to public read — the `storage.js` config does this on the first request via `createIfNotExists({ access: 'blob' })`

---

## Configure GitHub Actions

After provisioning:

1. **Add a repository variable** (`Settings → Secrets and variables → Actions → Variables`):
   - Name: `AZURE_WEBAPP_NAME`
   - Value: the app name printed by `provision.sh` (e.g. `booknook-api-ab12cd34`)

2. **Add a repository secret**:
   - In the Azure portal, open your App Service → **Get publish profile** → download the XML file
   - In GitHub: `Settings → Secrets and variables → Actions → New repository secret`
   - Name: `AZURE_WEBAPP_PUBLISH_PROFILE`
   - Value: paste the entire XML content

3. **Push to `main`** — the workflow installs dependencies, runs tests, and deploys automatically.

---

## Monitoring & Alerts

### View live logs

```bash
az webapp log tail \
  --name <your-app-name> \
  --resource-group booknook-rg
```

### Query logs in Log Analytics

In the Azure portal: Log Analytics workspace → Logs

```kql
// HTTP 5xx errors in the last hour
AppServiceHTTPLogs
| where TimeGenerated > ago(1h)
| where ScStatus >= 500
| project TimeGenerated, CsMethod, CsUriStem, ScStatus, TimeTaken
| order by TimeGenerated desc
```

```kql
// P95 response time by endpoint (last 24h)
AppServiceHTTPLogs
| where TimeGenerated > ago(24h)
| summarize percentile(TimeTaken, 95) by CsUriStem
| order by percentile_TimeTaken_95 desc
```

### Alerts

An HTTP 5xx alert is created by `provision.sh`. To see it:
- Azure portal → Monitor → Alerts

To add more alerts (e.g. slow response times), use:
```bash
az monitor metrics alert create \
  --name "booknook-slow-response" \
  --resource-group booknook-rg \
  --scopes <app-service-resource-id> \
  --condition "avg HttpResponseTime > 2" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --severity 3
```

---

## Security Notes

| Concern | How it's handled |
|---------|-----------------|
| No passwords in code | SQL connection string stored in Key Vault; retrieved at runtime via a Key Vault reference app setting |
| No passwords in environment variables | The Key Vault reference (`@Microsoft.KeyVault(...)`) is the app setting value; Azure resolves it before the app sees it |
| Managed identity | App Service uses its system-assigned identity to authenticate to SQL, Key Vault, and Blob Storage — no credentials to rotate |
| HTTPS only | Enforced at the App Service level; HTTP requests are redirected |
| Security headers | `helmet` middleware sets `X-Content-Type-Options`, `X-Frame-Options`, CSP, etc. |
| File upload limits | Multer enforces 5 MB max and restricts to JPEG/PNG/WebP |
| Input validation | All POST/PATCH bodies validated before hitting the database |
| Parameterised queries | All SQL uses `mssql` named parameters — no string concatenation |

---

## Teardown

When you're done and want to stop all charges:

```bash
./scripts/teardown.sh
```

This deletes the entire `booknook-rg` resource group and everything in it.
