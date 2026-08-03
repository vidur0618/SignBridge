# Google Cloud setup on Windows

This is an operator runbook, not evidence that Google Cloud has been configured.
Do not run downloaded installers without verifying their publisher, and never place
an access token or service-account JSON file in this repository.

The Linux `setup_adc.sh` sample is not the setup path for this native Windows app:
it installs tooling for a different operating system, enables Vertex AI rather than
Speech-to-Text, and would create credentials outside the Windows process that runs
SignBridge.

## 1. Install and verify the Cloud CLI

Use Google's official [Windows installation guide](https://docs.cloud.google.com/sdk/docs/install-sdk).
An operator must explicitly approve and complete the installer. If it is downloaded
manually, verify that Windows reports a valid Authenticode signature from Google LLC
before running it.

After installation, open a new PowerShell window:

```powershell
gcloud version
```

## 2. Select a billed project and enable Speech-to-Text

```powershell
$signBridgeProject = "YOUR_PROJECT_ID"

gcloud auth login
gcloud config set project $signBridgeProject
gcloud services enable speech.googleapis.com --project $signBridgeProject
```

The operator needs permission to enable the API. The identity used for recognition
needs `roles/serviceusage.serviceUsageConsumer` on the quota project and an
appropriate Speech role such as `roles/speech.client`. Keep the local user identity
separate from the Cloud Run runtime service account.

## 3. Create native Windows Application Default Credentials

```powershell
gcloud auth application-default login
gcloud auth application-default set-quota-project $signBridgeProject
gcloud auth application-default print-access-token
```

The last command should succeed, but its token must not be copied into logs, Git, or
`.env`. Do not set `GOOGLE_APPLICATION_CREDENTIALS` for this user-ADC flow. Google
documents this process in [Set up ADC for a local development environment](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc).

## 4. Verify Chirp 3 with the matching regional endpoint

SignBridge defaults to the GA `us` multi-region, uses
`us-speech.googleapis.com`, and builds a recognizer resource in `locations/us`.
The endpoint, resource location, and model must agree. Google's current
[Chirp 3 documentation](https://docs.cloud.google.com/speech-to-text/v2/docs/chirp-model)
lists the supported locations and shows the regional endpoint pattern.

Use only synthetic, non-identifying audio for the first smoke test. Record the
project, ADC identity, quota project, endpoint, recognizer resource, model, request
time, response status, and provider request identifiers in the private evidence
package. Do not record the transcript in application telemetry.

Then set the local runtime variables outside Git:

```powershell
$env:USE_GOOGLE_CLOUD = "true"
$env:GOOGLE_CLOUD_PROJECT = $signBridgeProject
$env:GOOGLE_SPEECH_LOCATION = "us"
$env:GOOGLE_SPEECH_RECOGNIZER = "_"
$env:GOOGLE_SPEECH_MODEL = "chirp_3"
```

Cloud Run must use its attached least-privilege service account through workload
identity. Do not upload the local ADC file or a service-account key to Cloud Run.
