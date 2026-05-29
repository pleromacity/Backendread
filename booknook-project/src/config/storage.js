const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const CONTAINER_NAME = 'covers';

function getBlobServiceClient() {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  if (!accountName) {
    throw new Error('AZURE_STORAGE_ACCOUNT_NAME environment variable is not set');
  }

  // Managed identity in Azure; falls back to az CLI / env vars locally
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential
  );
}

async function getContainerClient() {
  const client = getBlobServiceClient();
  const container = client.getContainerClient(CONTAINER_NAME);
  // Ensure container exists with public blob (not container) access
  await container.createIfNotExists({ access: 'blob' });
  return container;
}

module.exports = { getContainerClient, CONTAINER_NAME };
