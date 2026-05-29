#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BookNook – Azure resource provisioning script
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
RESOURCE_GROUP="booknook-rg"
LOCATION="westeurope"
APP_NAME="booknook-api-$(openssl rand -hex 4 | tr -d \'\r\n\')"
SQL_SERVER_NAME="booknook-sql-$(openssl rand -hex 4 | tr -d \'\r\n\')"
SQL_DB_NAME="booknook"
SQL_ADMIN="booknookadmin"
SQL_PASSWORD="$(openssl rand -base64 20 | tr -d \'\r\n\')Aa1!"
STORAGE_ACCOUNT="booknookstor$(openssl rand -hex 4 | tr -d \'\r\n\')"
KEY_VAULT_NAME="booknook-kv-$(openssl rand -hex 4 | tr -d \'\r\n\')"
APP_SERVICE_PLAN="booknook-plan"
LOG_WORKSPACE="booknook-logs"
ALERT_EMAIL="wanaemiw@gmail.com"

# Helper: strip Windows carriage returns from command output
trim() { tr -d '\r\n[:space:]'; }

# ── Pre-flight ────────────────────────────────────────────────────────────────
echo "Checking login..."
SUBSCRIPTION_ID=$(az account show --query id --output tsv | trim)
CURRENT_USER=$(az ad signed-in-user show --query id --output tsv 2>/dev/null | trim || true)

if [ -z "$CURRENT_USER" ]; then
  CURRENT_USER_EMAIL=$(az account show --query user.name --output tsv | trim)
  CURRENT_USER=$(az ad user show --id "$CURRENT_USER_EMAIL" --query id --output tsv 2>/dev/null | trim || true)
fi

if [ -z "$CURRENT_USER" ]; then
  echo "ERROR: Could not resolve current user. Run: az login"
  exit 1
fi

echo "  User object ID : $CURRENT_USER"
echo "  Subscription   : $SUBSCRIPTION_ID"

# ── 1. Resource Group ─────────────────────────────────────────────────────────
echo "Creating resource group..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

RG_SCOPE=$(az group show --name "$RESOURCE_GROUP" --query id --output tsv | trim)
echo "  RG scope: $RG_SCOPE"

# ── 2. SQL Server + Database ──────────────────────────────────────────────────
echo "Creating SQL Server..."
az sql server create \
  --name "$SQL_SERVER_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --admin-user "$SQL_ADMIN" \
  --admin-password "$SQL_PASSWORD" \
  --output none

echo "Opening SQL firewall for Azure services..."
az sql server firewall-rule create \
  --resource-group "$RESOURCE_GROUP" \
  --server "$SQL_SERVER_NAME" \
  --name "AllowAzureServices" \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0 \
  --output none

echo "Creating SQL Database (serverless, free tier)..."
az sql db create \
  --resource-group "$RESOURCE_GROUP" \
  --server "$SQL_SERVER_NAME" \
  --name "$SQL_DB_NAME" \
  --edition GeneralPurpose \
  --family Gen5 \
  --capacity 1 \
  --compute-model Serverless \
  --auto-pause-delay 60 \
  --min-capacity 0.5 \
  --output none

# ── 3. Storage Account ────────────────────────────────────────────────────────
echo "Creating Storage Account..."
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --allow-blob-public-access true \
  --https-only true \
  --output none

# ── 4. Key Vault ──────────────────────────────────────────────────────────────
echo "Creating Key Vault..."
az keyvault create \
  --name "$KEY_VAULT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku standard \
  --enable-rbac-authorization true \
  --output none

KV_SCOPE=$(az keyvault show \
  --name "$KEY_VAULT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query id \
  --output tsv | trim)

echo "  Key Vault scope: $KV_SCOPE"
echo "  Waiting 30s for Key Vault to propagate..."
sleep 30

echo "Assigning Key Vault Secrets Officer to current user..."
az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee "$CURRENT_USER" \
  --scope "$RG_SCOPE" \
  --output none

echo "  Waiting 40s for role assignment to propagate..."
sleep 40

echo "Storing SQL connection string in Key Vault..."
SQL_CONN="Server=tcp:${SQL_SERVER_NAME}.database.windows.net,1433;Database=${SQL_DB_NAME};Authentication=Active Directory Default;Encrypt=True;"
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name "SqlConnectionString" \
  --value "$SQL_CONN" \
  --output none

# ── 5. App Service ────────────────────────────────────────────────────────────
echo "Creating App Service Plan..."
az appservice plan create \
  --name "$APP_SERVICE_PLAN" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --is-linux \
  --sku B1 \
  --output none

echo "Creating Web App..."
az webapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$APP_SERVICE_PLAN" \
  --runtime "NODE:24-lts" \
  --output none

az webapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --https-only true \
  --output none

az webapp config set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --startup-file "node src/server.js" \
  --output none

# ── 6. Managed Identity ───────────────────────────────────────────────────────
echo "Enabling system-assigned managed identity..."
PRINCIPAL_ID=$(az webapp identity assign \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query principalId \
  --output tsv | trim)

echo "  Managed identity principal: $PRINCIPAL_ID"
echo "  Waiting 60s for identity to propagate to Azure AD..."
sleep 60

# Assign managed identity roles at resource group scope
for ROLE in "Key Vault Secrets User" "Storage Blob Data Contributor"; do
  for i in 1 2 3 4 5; do
    echo "  Attempt $i: assigning '$ROLE'..."
    if az role assignment create \
      --role "$ROLE" \
      --assignee "$PRINCIPAL_ID" \
      --scope "$RG_SCOPE" \
      --output none 2>/dev/null; then
      echo "  Assigned '$ROLE' successfully."
      break
    fi
    [ $i -lt 5 ] && echo "  Not ready, waiting 20s..." && sleep 20
  done
done

az sql server ad-admin create \
  --server "$SQL_SERVER_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --display-name "booknook-app" \
  --object-id "$PRINCIPAL_ID" \
  --output none

# ── 7. App Settings ───────────────────────────────────────────────────────────
echo "Configuring app settings..."
SECRET_URI=$(az keyvault secret show \
  --vault-name "$KEY_VAULT_NAME" \
  --name "SqlConnectionString" \
  --query id \
  --output tsv | trim)

az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    "AZURE_SQL_CONNECTIONSTRING=@Microsoft.KeyVault(SecretUri=${SECRET_URI})" \
    "AZURE_STORAGE_ACCOUNT_NAME=${STORAGE_ACCOUNT}" \
    "NODE_ENV=production" \
  --output none

# ── 8. Log Analytics Workspace ────────────────────────────────────────────────
echo "Creating Log Analytics workspace..."
WORKSPACE_ID=$(az monitor log-analytics workspace create \
  --resource-group "$RESOURCE_GROUP" \
  --workspace-name "$LOG_WORKSPACE" \
  --location "$LOCATION" \
  --query id \
  --output tsv | trim)

APP_ID=$(az webapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query id \
  --output tsv | trim)

echo "  App ID: $APP_ID"

az monitor diagnostic-settings create \
  --name "booknook-diag" \
  --resource "$APP_ID" \
  --workspace "$WORKSPACE_ID" \
  --logs '[{"category":"AppServiceHTTPLogs","enabled":true},{"category":"AppServiceConsoleLogs","enabled":true}]' \
  --metrics '[{"category":"AllMetrics","enabled":true}]' \
  --output none

# ── 9. Alert – HTTP 5xx errors ────────────────────────────────────────────────
echo "Creating HTTP 5xx alert..."
ACTION_GROUP_ID=$(az monitor action-group create \
  --name "booknook-email-ag" \
  --resource-group "$RESOURCE_GROUP" \
  --short-name "bnemail" \
  --action email admin "$ALERT_EMAIL" \
  --query id \
  --output tsv | trim)

az monitor metrics alert create \
  --name "booknook-5xx-alert" \
  --resource-group "$RESOURCE_GROUP" \
  --scopes "$APP_ID" \
  --condition "count Http5xx > 5" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --severity 2 \
  --description "BookNook – more than 5 HTTP 5xx errors in 5 minutes" \
  --action "$ACTION_GROUP_ID" \
  --output none

# ── 10. Budget ────────────────────────────────────────────────────────────────
echo "Creating budget..."
BUDGET_START=$(date +%Y-%m-01)

az consumption budget create \
  --budget-name "booknook-budget" \
  --amount 10 \
  --time-grain Monthly \
  --start-date "$BUDGET_START" \
  --end-date "2026-12-31" \
  --resource-group "$RESOURCE_GROUP" \
  --notifications "[{\"enabled\":true,\"operator\":\"GreaterThan\",\"threshold\":80,\"contactEmails\":[\"${ALERT_EMAIL}\"],\"thresholdType\":\"Actual\"},{\"enabled\":true,\"operator\":\"GreaterThan\",\"threshold\":100,\"contactEmails\":[\"${ALERT_EMAIL}\"],\"thresholdType\":\"Actual\"}]" \
  2>/dev/null || echo "  ⚠  Budget skipped – create manually in Cost Management if needed."

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo "  BookNook provisioning complete!"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  App URL :  https://${APP_NAME}.azurewebsites.net"
echo "  Health  :  https://${APP_NAME}.azurewebsites.net/health"
echo ""
echo "  SQL admin password: ${SQL_PASSWORD}"
echo "  (save this – it is not stored in Key Vault)"
echo ""
echo "  Next steps:"
echo "  1. Add AZURE_WEBAPP_NAME=${APP_NAME} as a GitHub Actions variable"
echo "  2. Download the publish profile from the App Service blade"
echo "     and add it as the AZURE_WEBAPP_PUBLISH_PROFILE secret"
echo "  3. Push to main – the workflow will deploy automatically"
echo "════════════════════════════════════════════════════════"