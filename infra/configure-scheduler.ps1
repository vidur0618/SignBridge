param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$Region,
  [Parameter(Mandatory = $true)][string]$ServiceUrl,
  [string]$JobName = "signbridge-daily-operations",
  [string]$ServiceAccount = ""
)

$ErrorActionPreference = "Stop"
if (-not $ServiceAccount) {
  $ServiceAccount = "signbridge-scheduler@$ProjectId.iam.gserviceaccount.com"
}

gcloud scheduler jobs describe $JobName --project $ProjectId --location $Region 2>$null
if ($LASTEXITCODE -eq 0) {
  gcloud scheduler jobs update http $JobName `
    --project $ProjectId `
    --location $Region `
    --schedule "0 6 * * *" `
    --time-zone "America/New_York" `
    --uri "$ServiceUrl/api/internal/operations/daily" `
    --http-method POST `
    --oidc-service-account-email $ServiceAccount `
    --oidc-token-audience $ServiceUrl
} else {
  gcloud scheduler jobs create http $JobName `
    --project $ProjectId `
    --location $Region `
    --schedule "0 6 * * *" `
    --time-zone "America/New_York" `
    --uri "$ServiceUrl/api/internal/operations/daily" `
    --http-method POST `
    --oidc-service-account-email $ServiceAccount `
    --oidc-token-audience $ServiceUrl
}
