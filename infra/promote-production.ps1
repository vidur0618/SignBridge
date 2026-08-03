param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$Region,
  [Parameter(Mandatory = $true)][ValidatePattern('^sha256:[a-f0-9]{64}$')][string]$ImageDigest,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{7,64}$')][string]$CommitSha,
  [Parameter(Mandatory = $true)][string]$AppOrigin,
  [Parameter(Mandatory = $true)][string]$SignAssetBucket,
  [Parameter(Mandatory = $true)][string]$PilotSiteId,
  [Parameter(Mandatory = $true)][string]$CatalogPath,
  [string]$ArtifactRepository = "signbridge",
  [string]$Image = "signbridge-reception",
  [string]$Service = "signbridge-reception",
  [string]$SchedulerServiceAccount = ""
)

$ErrorActionPreference = "Stop"
if (-not $SchedulerServiceAccount) {
  $SchedulerServiceAccount = "signbridge-scheduler@$ProjectId.iam.gserviceaccount.com"
}
$ImageReference = "$Region-docker.pkg.dev/$ProjectId/$ArtifactRepository/$Image@$ImageDigest"
$RuntimeServiceAccount = "signbridge-runtime@$ProjectId.iam.gserviceaccount.com"
$Environment = "USE_GOOGLE_CLOUD=true,GOOGLE_CLOUD_PROJECT=$ProjectId,GOOGLE_CLOUD_LOCATION=global,GOOGLE_SPEECH_LOCATION=us,GOOGLE_SPEECH_RECOGNIZER=_,GOOGLE_SPEECH_MODEL=chirp_3,GEMINI_MODEL=gemini-3.6-flash,SIGN_ASSET_BUCKET=$SignAssetBucket,SIGN_CATALOG_PATH=$CatalogPath,FIRESTORE_DATABASE=(default),EVENT_RETENTION_DAYS=30,PILOT_SITE_ID=$PilotSiteId,APP_ORIGIN=$AppOrigin,INTERNAL_OIDC_AUDIENCE=$AppOrigin,INTERNAL_OIDC_SERVICE_ACCOUNT=$SchedulerServiceAccount,DEPLOYMENT_SHA=$CommitSha"

gcloud run deploy $Service `
  --project $ProjectId `
  --region $Region `
  --platform managed `
  --image $ImageReference `
  --allow-unauthenticated `
  --service-account $RuntimeServiceAccount `
  --cpu 1 `
  --memory 1Gi `
  --concurrency 10 `
  --min-instances 1 `
  --max-instances 1 `
  --timeout 300 `
  --session-affinity `
  --set-env-vars $Environment `
  --set-secrets "SESSION_SECRET=signbridge-session-secret:latest,PILOT_SITE_CODE=signbridge-site-code:latest,ADMIN_ACCESS_CODE=signbridge-admin-code:latest,HANDTALK_TOKEN=signbridge-handtalk-token:latest"

if ($LASTEXITCODE -ne 0) { throw "Production promotion failed." }
gcloud run services describe $Service `
  --project $ProjectId `
  --region $Region `
  --format "yaml(status.url,status.latestReadyRevisionName,spec.template.spec.containers[0].image)"
