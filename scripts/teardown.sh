#!/usr/bin/env bash
# Deletes the entire BookNook resource group (and everything in it).
# Use when you're done with the project to avoid ongoing charges.
set -euo pipefail

RESOURCE_GROUP="booknook-rg"

echo "⚠  This will permanently delete resource group: ${RESOURCE_GROUP}"
read -r -p "Type the resource group name to confirm: " confirm

if [[ "$confirm" != "$RESOURCE_GROUP" ]]; then
  echo "Aborted."
  exit 1
fi

az group delete --name "$RESOURCE_GROUP" --yes --no-wait
echo "Deletion started (runs in the background)."
