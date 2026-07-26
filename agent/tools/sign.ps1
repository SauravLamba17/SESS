<#
  Authenticode-sign the built installer with the self-signed certificate.

  WHY THIS IS A SEPARATE STEP rather than electron-builder's own signing:
  electron-builder signs via a bundled "winCodeSign" toolchain whose archive
  contains macOS symlinks. Extracting it on Windows fails with "Cannot create
  symbolic link: A required privilege is not held by the client" unless the
  build runs elevated or with Developer Mode on. Signing with Windows' own
  Set-AuthenticodeSignature avoids that toolchain entirely and needs no SDK,
  no elevation and no extra install - it is present on every Windows machine.

  Called by tools/build.js. Can also be run by hand:
    powershell -ExecutionPolicy Bypass -File tools\sign.ps1 -Path dist\the-installer.exe

  NOTE: pure ASCII on purpose - PowerShell 5.1 reads a BOM-less .ps1 as ANSI,
  and a UTF-8 dash would become a smart quote and break parsing.
#>

param(
  [Parameter(Mandatory = $true)][string]$Path,
  # Defaults are resolved in the body, not here: $PSScriptRoot is not reliably
  # populated inside a param() default block when the script is invoked with
  # -File, which silently produced an empty path.
  [string]$Pfx = "",
  [string]$PasswordFile = "",
  # A timestamp keeps the signature verifiable after the certificate expires.
  # Non-fatal if unreachable - an untimestamped signature is still valid now.
  [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if ([string]::IsNullOrWhiteSpace($Pfx)) {
  $Pfx = Join-Path $scriptDir "..\certs\sess-agent-signing.pfx"
}
if ([string]::IsNullOrWhiteSpace($PasswordFile)) {
  $PasswordFile = Join-Path $scriptDir "..\certs\cert-password.txt"
}

if (-not (Test-Path $Path))         { Write-Error "File to sign not found: $Path"; exit 1 }
if (-not (Test-Path $Pfx))          { Write-Error "Certificate not found: $Pfx. Run 'npm run make-cert' first."; exit 1 }
if (-not (Test-Path $PasswordFile)) { Write-Error "Password file not found: $PasswordFile"; exit 1 }

$plain  = (Get-Content $PasswordFile -Raw).Trim()
$secure = ConvertTo-SecureString -String $plain -Force -AsPlainText
$cert   = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 `
            -ArgumentList $Pfx, $secure, "Exportable"

Write-Host ("Signing {0}" -f (Split-Path $Path -Leaf))
Write-Host ("  with  {0}" -f $cert.Subject)

$signArgs = @{
  FilePath      = $Path
  Certificate   = $cert
  HashAlgorithm = "SHA256"
}

try {
  $result = Set-AuthenticodeSignature @signArgs -TimestampServer $TimestampServer
} catch {
  Write-Host "  timestamp server unreachable; signing without a timestamp." -ForegroundColor Yellow
  $result = Set-AuthenticodeSignature @signArgs
}

Write-Host ("  status: {0}" -f $result.Status)

# Valid  = trusted on THIS machine (the cert is in its store here).
# UnknownError / NotTrusted = signed correctly, but this machine does not trust
# the issuer yet. That is EXPECTED for a self-signed certificate before the
# one-time per-machine import described in README.md, and is not a failure.
if ($result.Status -eq "Valid" -or $result.Status -eq "UnknownError" -or $result.Status -eq "NotTrusted") {
  $sig = Get-AuthenticodeSignature $Path
  if ($null -eq $sig.SignerCertificate) {
    Write-Error "No signature was attached to the file."
    exit 1
  }
  Write-Host ("  signer: {0}" -f $sig.SignerCertificate.Subject)
  Write-Host ("  digest: {0}" -f $sig.SignatureType)
  Write-Host "  signed OK." -ForegroundColor Green
  exit 0
}

Write-Error ("Signing failed: {0} - {1}" -f $result.Status, $result.StatusMessage)
exit 1
