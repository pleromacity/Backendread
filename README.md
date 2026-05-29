# BookNook API 📚

A REST API for a book-club reading tracker. Members can add books, update their reading status, rate finished books, and upload cover images.

**Built with:** Node.js + Express · Azure SQL Database · Azure Blob Storage · Azure Key Vault · Azure App Service · GitHub Actions

---

## Table of Contents

1. [What you built](#what-you-built)
2. [Project structure](#project-structure)
3. [API endpoints](#api-endpoints)
4. [Local development](#local-development)
5. [Provision Azure resources](#provision-azure-resources)
6. [Grant the managed identity SQL access](#grant-the-managed-identity-sql-access)
7. [Configure GitHub Actions](#configure-github-actions)
8. [Verify it is live](#verify-it-is-live)
9. [Monitoring and alerts](#monitoring-and-alerts)
10. [Security notes](#security-notes)
11. [Teardown](#teardown)
12. [Azure provisioning troubleshooting guide](#azure-provisioning-troubleshooting-guide)

---

## What You Built

| Azure service | Purpose |
|---|---|
| App Service (Linux, Node 20) | Hosts the REST API, HTTPS only |
| Azure SQL Database (serverless) | Stores books and ratings, auto-pauses when idle |
| Azure Blob Storage | Stores book cover images with public read access |
| Azure Key Vault | Stores the SQL connection string as a secret |
| System-assigned managed identity | Lets the app authenticate to SQL, Key Vault, and Blob Storage — no passwords in code |
| Log Analytics workspace | Collects HTTP and console logs |
| Azure Monitor alert | Fires when more than 5 HTTP 5xx errors occur in 5 minutes |
| GitHub Actions | Deploys automatically on every push to `main` |

---

## Project Structure

```
booknook/
├── src/
│   ├── server.js           # Entry point
│   ├── app.js              # Express app and middleware
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
| `GET` | `/health` | Health check — confirms DB connectivity |
| `GET` | `/api/books` | List all books. Optional `?status=` and `?genre=` filters |
| `GET` | `/api/books/:id` | Get a single book |
| `POST` | `/api/books` | Add a new book |
| `PATCH` | `/api/books/:id` | Update status, rating, notes, or genre |
| `DELETE` | `/api/books/:id` | Remove a book |
| `POST` | `/api/books/:id/cover` | Upload a cover image (multipart/form-data, field name `cover`) |

### Data model

```sql
CREATE TABLE Books (
  Id         INT           PRIMARY KEY IDENTITY(1,1),
  Title      NVARCHAR(200) NOT NULL,
  Author     NVARCHAR(100) NOT NULL,
  Genre      NVARCHAR(50)  DEFAULT 'Fiction',
  Status     NVARCHAR(20)  DEFAULT 'To Read',   -- 'To Read' | 'Reading' | 'Finished'
  Rating     INT           NULL,                 -- 1-5, only set when Finished
  Notes      NVARCHAR(MAX) DEFAULT '',
  CoverUrl   NVARCHAR(500) DEFAULT '',
  AddedAt    DATETIME2     DEFAULT GETUTCDATE()
);
```

### Example requests

**Add a book (PowerShell)**
```powershell
Invoke-RestMethod -Method POST `
  -Uri "https://<your-app>.azurewebsites.net/api/books" `
  -ContentType "application/json" `
  -Body '{"Title":"Dune","Author":"Frank Herbert","Genre":"Sci-Fi"}'
```

**Mark as finished and rate it**
```powershell
Invoke-RestMethod -Method PATCH `
  -Uri "https://<your-app>.azurewebsites.net/api/books/1" `
  -ContentType "application/json" `
  -Body '{"Status":"Finished","Rating":5,"Notes":"Absolutely brilliant."}'
```

**Upload a cover image**
```bash
curl -X POST https://<your-app>.azurewebsites.net/api/books/1/cover \
  -F "cover=@dune.jpg"
```

---

## Local Development

### Prerequisites

- Node.js 18+
- Azure CLI installed and logged in (`az login`)
- An Azure SQL database you can reach

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your SQL credentials and storage account name

# 3. Start the dev server (auto-reloads on change)
npm run dev

# 4. Confirm it is working
curl http://localhost:3000/health
```

---

## Provision Azure Resources

> Before running: edit the `ALERT_EMAIL` variable near the top of `scripts/provision.sh`.

```bash
# On Windows, run this inside Git Bash or WSL
bash scripts/provision.sh
```

The script creates every Azure resource automatically and prints your app URL and SQL admin password at the end. **Save the SQL admin password** — it is printed once and not stored anywhere in Azure.

---

## Grant the Managed Identity SQL Access

This step is required after provisioning. The managed identity needs permission to read and write the database. It cannot be added via the portal Query Editor with SQL auth — it requires an Azure AD connection.

### Step 1 — Make your account the SQL Azure AD admin

```bash
az sql server ad-admin create \
  --server <your-sql-server-name> \
  --resource-group booknook-rg \
  --display-name "me" \
  --object-id <your-object-id>
```

Your object ID is printed at the top of the provision script output. Your SQL server name follows the pattern `booknook-sql-XXXXXXXX`.

### Step 2 — Run the grant commands via Azure CLI

```bash
az sql db query \
  --server <your-sql-server-name> \
  --database booknook \
  --resource-group booknook-rg \
  --query-text "CREATE USER [<your-app-name>] FROM EXTERNAL PROVIDER; ALTER ROLE db_datareader ADD MEMBER [<your-app-name>]; ALTER ROLE db_datawriter ADD MEMBER [<your-app-name>]; ALTER ROLE db_ddladmin ADD MEMBER [<your-app-name>];"
```

Replace `<your-app-name>` with the web app name (e.g. `booknook-api-f6cb9bad`).

### Alternative — Portal Query Editor

If the CLI command is not available in your version:

1. Go to your SQL database in the portal
2. Click **Query editor** in the left sidebar
3. On the login screen select **Active Directory authentication** (not SQL auth)
4. Paste and run these four lines:

```sql
CREATE USER [booknook-api-XXXXXXXX] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [booknook-api-XXXXXXXX];
ALTER ROLE db_datawriter ADD MEMBER [booknook-api-XXXXXXXX];
ALTER ROLE db_ddladmin   ADD MEMBER [booknook-api-XXXXXXXX];
```

> If you see "Your IP address isn't allowed" click the **Allowlist IP** button on that page and wait 5 minutes before trying again.

> If you see "Principal could not be created. Only connections established with Active Directory accounts can create other Active Directory users" — you are logged into the Query Editor with SQL auth. Log out and log back in using **Active Directory authentication**.

---

## Configure GitHub Actions

### 1. Push the code to GitHub

Create a new empty repository on github.com (no README, no .gitignore), then:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/booknook.git
git push -u origin main
```

### 2. Create Azure credentials for GitHub

```bash
az ad sp create-for-rbac \
  --name "booknook-github" \
  --role contributor \
  --scopes /subscriptions/<your-subscription-id>/resourceGroups/booknook-rg \
  --sdk-auth
```

Copy the entire JSON block that is printed.

### 3. Add the GitHub variable and secret

In your GitHub repo go to **Settings → Secrets and variables → Actions**.

**Variables tab** — click New repository variable:
```
Name:  AZURE_WEBAPP_NAME
Value: booknook-api-XXXXXXXX
```

**Secrets tab** — click New repository secret:
```
Name:  AZURE_CREDENTIALS
Value: <paste the entire JSON from step 2>
```

### 4. Trigger the first deploy

```bash
git commit --allow-empty -m "Trigger first deploy"
git push
```

Go to the **Actions** tab in your GitHub repo and watch the workflow run. It takes about 2 minutes. When the workflow goes green, the API is live.

---

## Verify It Is Live

**Health check:**
```bash
curl https://booknook-api-XXXXXXXX.azurewebsites.net/health
```

Expected response:
```json
{"status":"healthy","db":"connected","ts":"2024-11-01T10:00:00.000Z"}
```

**Add a book (PowerShell):**
```powershell
Invoke-RestMethod -Method POST `
  -Uri "https://booknook-api-XXXXXXXX.azurewebsites.net/api/books" `
  -ContentType "application/json" `
  -Body '{"Title":"Dune","Author":"Frank Herbert","Genre":"Sci-Fi"}'
```

Expected response:
```
Id       : 1
Title    : Dune
Author   : Frank Herbert
Genre    : Sci-Fi
Status   : To Read
Rating   :
Notes    :
CoverUrl :
AddedAt  : 2024-11-01T11:44:48.386Z
```

---

## Monitoring and Alerts

**View live logs:**
```bash
az webapp log tail \
  --name booknook-api-XXXXXXXX \
  --resource-group booknook-rg
```

**Query logs in Log Analytics** (Azure portal → Log Analytics workspace → Logs):
```kql
AppServiceHTTPLogs
| where TimeGenerated > ago(1h)
| where ScStatus >= 500
| project TimeGenerated, CsMethod, CsUriStem, ScStatus, TimeTaken
| order by TimeGenerated desc
```

A HTTP 5xx alert fires automatically when more than 5 server errors occur in 5 minutes. View it at: Azure portal → Monitor → Alerts.

---

## Security Notes

| Concern | How it is handled |
|---------|------------------|
| No passwords in code | SQL connection string stored in Key Vault, retrieved via a Key Vault reference app setting |
| No passwords in environment variables | The `@Microsoft.KeyVault(...)` reference is the app setting value — Azure resolves it before the app sees it |
| Managed identity | App Service authenticates to SQL, Key Vault, and Blob Storage using its system-assigned identity |
| HTTPS only | Enforced at the App Service level |
| Security headers | `helmet` middleware sets `X-Content-Type-Options`, `X-Frame-Options`, CSP, and others |
| File upload limits | Multer enforces 5 MB max, JPEG/PNG/WebP only |
| Input validation | All POST and PATCH bodies validated before hitting the database |
| Parameterised queries | All SQL uses `mssql` named parameters — no string concatenation |

---

## Teardown

```bash
bash scripts/teardown.sh
```

Deletes the entire `booknook-rg` resource group and everything in it.

---

## Azure Provisioning Troubleshooting Guide

Every error encountered during provisioning on Windows (WSL + PowerShell, Azure CLI, region: West Europe) and the fix for each one.

---

### Error 1 — Namespace Not Registered

**Message:**
```
(MissingSubscriptionRegistration) The subscription is not registered
to use namespace 'Microsoft.KeyVault'.
```

**Cause:** Azure subscriptions do not pre-register all resource providers.

**Fix:**
```bash
az provider register --namespace Microsoft.KeyVault
az provider show --namespace Microsoft.KeyVault --query "registrationState"
# Should return: "Registered"
```

---

### Error 2 — Forbidden: No Permission to Set Secrets

**Message:**
```
(Forbidden) Caller is not authorized to perform action on resource.
Action: 'Microsoft.KeyVault/vaults/secrets/setSecret/action'
Inner error: { "code": "ForbiddenByRbac" }
```

**Cause:** The signed-in user lacked the Key Vault Secrets Officer role. With RBAC enabled, the Owner role does not automatically grant data plane access to Key Vault.

**Fix:**
```bash
az ad signed-in-user show --query id -o tsv

az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee <your-object-id> \
  --scope /subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<vault>
```

Wait 2–5 minutes for RBAC to propagate before retrying.

---

### Error 3 — DNS Resolution Failure

**Message:**
```
Failed to resolve 'management.azure.com' ([Errno 11001] getaddrinfo failed)
```

**Cause:** The machine could not reach Azure's management endpoint.

**Fix:**
```bash
# Fix WSL DNS
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf

# Set proxy if required
set HTTPS_PROXY=http://your-proxy:port
```

---

### Error 4 — Role Lost Between Script Runs

**Problem:** Every run generated a new random Key Vault name so manually-assigned roles from previous runs did not carry over.

**Fix:** Move the role assignment inside the script immediately after Key Vault creation and add a propagation wait.

---

### Error 5 — KV_NAME Unbound Variable

**Message:**
```
./scripts/provision.sh: line 90: KV_NAME: unbound variable
```

**Cause:** The role assignment block was placed before `KV_NAME` was defined. `set -euo pipefail` exits immediately on unbound variables.

**Fix:** Validate variables before use and ensure correct ordering in the script.

---

### Error 6 — Key Vault Already Exists in Deleted State

**Message:**
```
(ConflictError) A vault with the same name already exists in deleted state.
```

**Cause:** Azure Key Vault uses soft delete with 90-day retention. Deleting the resource group does not permanently remove the vault.

**Fix:**
```bash
az keyvault list-deleted --query "[].name" --output tsv | \
  xargs -I {} az keyvault purge --name {} --location westeurope
```

---

### Error 7 — Bad Request on Role Assignment

**Message:**
```
Operation returned an invalid status 'Bad Request'
```

**Cause:** The signed-in account was an external guest user. Azure rejected the assignment at vault scope due to a tenant-level policy.

**Fix:** Assign at resource group scope instead:
```bash
RG_SCOPE=$(az group show --name "$RESOURCE_GROUP" --query id --output tsv)

az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee "$CURRENT_USER" \
  --scope "$RG_SCOPE"
```

---

### Error 8 — No Owner Role to Create Role Assignments

**Message:**
```
Your account does not have Owner or User Access Administrator on subscription.
Role assignments will be skipped.
```

**Cause:** Creating role assignments requires Owner or User Access Administrator. The account only had Contributor.

**Fix:**
```bash
az role assignment create \
  --role Owner \
  --assignee <your-object-id> \
  --scope /subscriptions/<subscription-id>
```

---

### Error 9 — Cannot Set Access Policies on RBAC-Enabled Vault

**Message:**
```
Cannot set policies to a vault with '--enable-rbac-authorization' specified
```

**Cause:** A tenant-level Azure Policy automatically enforces RBAC on all Key Vaults, overriding the script.

**Fix:** Accept RBAC mode and use role assignments instead of access policies.

---

### Error 10 — Managed Identity Not Found in Graph Database

**Message:**
```
Cannot find user or service principal in graph database for '930f20e3-...'
```

**Cause — two issues combined:**
- The managed identity had not finished propagating to Azure AD. 20 seconds was not long enough.
- The principal ID was truncated by Windows `\r\n` line endings, producing a malformed UUID.

**Fix A — increase wait and add retries:**
```bash
sleep 60
for i in 1 2 3 4 5; do
  az role assignment create ... && break
  sleep 20
done
```

**Fix B — strip carriage returns:**
```bash
trim() { tr -d '\r\n[:space:]'; }
PRINCIPAL_ID=$(az webapp identity assign --query principalId --output tsv | trim)
```

---

### Error 11 — SQL Server ResourceNotFound

**Message:**
```
(ResourceNotFound) The Resource 'Microsoft.Sql/servers/booknook-sql-8eddfd17' was not found.
```

**Cause:** `\r` from Windows line endings appended to `openssl rand` output, causing a mismatch between the name used to create the server and the name used to look it up.

**Fix:**
```bash
SQL_SERVER_NAME="booknook-sql-$(openssl rand -hex 4 | tr -d '\r\n')"
APP_NAME="booknook-api-$(openssl rand -hex 4 | tr -d '\r\n')"
```

---

### Error 12 — App Service No Capacity

**Message:**
```
No available instances to satisfy this request.
```

**Cause:** The `westus2` region had no available capacity for the App Service Plan tier.

**Fix:**
```bash
LOCATION="westeurope"
```

---

### Error 13 — Diagnostic Settings Bad Request

**Message:**
```
usage error: --resource ID | --resource NAME --resource-group NAME
```

**Cause:** `APP_ID` captured with a trailing `\r`, producing a malformed resource ID.

**Fix:**
```bash
APP_ID=$(az webapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query id \
  --output tsv | trim)
echo "  App ID: $APP_ID"
```

---

### Root Cause Summary

| # | Error | Root cause | Fix |
|---|-------|-----------|-----|
| 1 | Namespace not registered | Provider not enabled | `az provider register` |
| 2 | Forbidden on secret set | Missing RBAC role | Assign Key Vault Secrets Officer |
| 3 | DNS resolution failed | No internet or proxy needed | Fix DNS or set proxy |
| 4 | Role lost between runs | New vault name per run | Add role assignment inside script |
| 5 | Unbound variable | Wrong script ordering | Validate and reorder variables |
| 6 | Vault in deleted state | Soft delete retention (90 days) | Purge soft-deleted vaults |
| 7 | Bad Request on role assign | Guest account + tenant policy | Use RG scope |
| 8 | No permission to assign roles | Missing Owner role | Grant Owner at subscription level |
| 9 | Cannot set access policies | Tenant enforces RBAC | Accept RBAC mode |
| 10 | Managed identity not found | `\r` in UUID + propagation delay | `trim()` + 60s wait + retries |
| 11 | SQL server not found | `\r` in openssl-generated name | Strip `\r\n` from all names |
| 12 | App Service no capacity | Region at capacity | Switch to `westeurope` or `eastus` |
| 13 | Diagnostic settings bad request | `\r` in `APP_ID` | Apply `trim()` to all captured IDs |

---

### Final Script Design Principles

```bash
# 1. Trim helper — strip \r\n from all CLI output
trim() { tr -d '\r\n[:space:]'; }
VARIABLE=$(az ... --output tsv | trim)

# 2. Strip \r\n from all generated names
KEY_VAULT_NAME="booknook-kv-$(openssl rand -hex 4 | tr -d '\r\n')"

# 3. Capture RG scope once and reuse everywhere
RG_SCOPE=$(az group show --name "$RESOURCE_GROUP" --query id --output tsv | trim)

# 4. Assign roles at resource group scope (avoids tenant policy issues)

# 5. Propagation waits
sleep 30   # after Key Vault creation
sleep 40   # after role assignment
sleep 60   # after managed identity creation

# 6. Retry loops for managed identity role assignments
for i in 1 2 3 4 5; do
  az role assignment create ... && break
  sleep 20
done

# 7. Always print key variables for debugging
echo "  Key Vault scope: $KV_SCOPE"
echo "  Managed identity principal: $PRINCIPAL_ID"
echo "  App ID: $APP_ID"
```

---

*README generated from the BookNook build session. Troubleshooting section compiled from live provisioning errors on Windows with WSL + Azure CLI.*
