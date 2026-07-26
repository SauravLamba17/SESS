<#
  ONE-TIME: create the self-signed code-signing certificate used to sign the
  SESS Idle Agent installer.

  This is the free, INTERNAL-ONLY path. It is appropriate here because the agent
  is distributed by hand to machines at two centralised sites (main floor and
  the Himachal office) - there is no public distribution, no Windows domain and
  no Active Directory to push policy through. IT imports the public half once
  per machine during rollout; see README.md.

  Run this ONCE, on the build machine, in PowerShell. Keep the resulting .pfx
  and its password secret - anyone holding them can sign software as you.

    npm run make-cert
      (or) powershell -ExecutionPolicy Bypass -File tools\make-cert.ps1

  Outputs into agent\certs\ (gitignored):
    sess-agent-signing.pfx  - private key + cert. BUILD MACHINE ONLY, never ship.
    sess-agent-signing.cer  - public half. This is what IT imports per machine.
    cert-password.txt       - the .pfx password, so the build can read it.

  NOTE: this file is deliberately pure ASCII. Windows PowerShell 5.1 reads a
  BOM-less .ps1 as ANSI, which turns a UTF-8 em dash into a smart quote and
  breaks parsing.
#>

param(
  [string]$Subject    = "CN=Simplen SESS Idle Agent, O=Simplen, C=IN",
  [int]   $ValidYears = 5,
  [string]$OutDir     = (Join-Path $PSScriptRoot "..\certs")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$pfxPath = Join-Path $OutDir "sess-agent-signing.pfx"
$cerPath = Join-Path $OutDir "sess-agent-signing.cer"
$pwdPath = Join-Path $OutDir "cert-password.txt"

if (Test-Path $pfxPath) {
  Write-Host "A certificate already exists at $pfxPath" -ForegroundColor Yellow
  Write-Host "Delete it first if you really mean to replace it. Every machine that"
  Write-Host "already trusts the old certificate would need the new one imported."
  exit 1
}

Write-Host "Creating self-signed code-signing certificate..." -ForegroundColor Cyan

# -Type CodeSigningCert is what makes this Authenticode-capable; a plain
# self-signed cert cannot sign an executable.
$cert = New-SelfSignedCertificate `
  -Subject $Subject `
  -Type CodeSigningCert `
  -KeyUsage DigitalSignature `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears($ValidYears)

Write-Host ("  Thumbprint: {0}" -f $cert.Thumbprint)
Write-Host ("  Expires:    {0}" -f $cert.NotAfter.ToString('yyyy-MM-dd'))

# A random password, written next to the .pfx so the build can read it without
# anyone having to remember or retype it.
$chars = (48..57) + (65..90) + (97..122)
$plain = -join ($chars | Get-Random -Count 32 | ForEach-Object { [char]$_ })
$securePwd = ConvertTo-SecureString -String $plain -Force -AsPlainText

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePwd | Out-Null
Export-Certificate    -Cert $cert -FilePath $cerPath -Type CERT           | Out-Null
Set-Content -Path $pwdPath -Value $plain -Encoding ascii -NoNewline

# The copy in the personal store has served its purpose; the .pfx is the
# artefact the build uses. Leaving it behind is an extra place the key lives.
Remove-Item ("Cert:\CurrentUser\My\{0}" -f $cert.Thumbprint) -Force

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ("  {0}" -f $pfxPath)
Write-Host "      signing key. Build machine only. Never distribute."
Write-Host ("  {0}" -f $cerPath)
Write-Host "      public half. Copy this to each machine during rollout."
Write-Host ("  {0}" -f $pwdPath)
Write-Host "      .pfx password, read by the build."
Write-Host ""
Write-Host "Next: npm run dist   (see README.md)"
