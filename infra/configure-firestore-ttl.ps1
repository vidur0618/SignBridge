param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Database = "(default)"
)

$ErrorActionPreference = "Stop"

gcloud firestore fields ttls update expiresAt `
  --project $ProjectId `
  --database $Database `
  --collection-group usageEvents `
  --enable-ttl

if ($LASTEXITCODE -ne 0) {
  throw "Failed to enable the usageEvents.expiresAt Firestore TTL policy."
}

gcloud firestore fields ttls list `
  --project $ProjectId `
  --database $Database
