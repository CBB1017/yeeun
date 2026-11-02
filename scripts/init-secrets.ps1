# Creates local secrets that do not exist yet. Never overwrites existing values.
# Optional operator secrets are created empty (= not configured) so Compose can start.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force .secrets | Out-Null
function Gen($name) {
  $p = Join-Path (Get-Location) ".secrets/$name"
  if (-not (Test-Path -LiteralPath $p) -or (Get-Item -LiteralPath $p).Length -eq 0) {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    [System.IO.File]::WriteAllText($p, [Convert]::ToHexString($bytes).ToLower())
  }
}
function Empty($name) {
  $p = Join-Path (Get-Location) ".secrets/$name"
  if (-not (Test-Path -LiteralPath $p)) { [System.IO.File]::WriteAllText($p, '') }
}
'postgres_password','app_master_key','session_secret','runner_token' | ForEach-Object { Gen $_ }
'google_client_secret','google_picker_api_key','smtp_password','vapid_private_key','ngrok_authtoken' | ForEach-Object { Empty $_ }
Write-Output 'secrets ready in .secrets/ (back up app_master_key and session_secret)'
