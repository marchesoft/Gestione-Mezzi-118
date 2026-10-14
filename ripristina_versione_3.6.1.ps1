# ==========================================================
# SCRIPT DI RIPRISTINO ALLA VERSIONE 3.6.1 BASE
# ==========================================================
# Esegui questo script per ripristinare tutti i file
# dell'applicazione Gestione Mezzi alla versione 3.6.1 stabile.

$currentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $currentDir) { $currentDir = Get-Location }
$baseDir = Join-Path $currentDir "_VERSIONE_3.6.1_BASE"

if (-not (Test-Path $baseDir)) {
    Write-Host "ERRORE: Cartella _VERSIONE_3.6.1_BASE non trovata in $currentDir" -ForegroundColor Red
    Pause
    exit 1
}

Write-Host "Ripristino Versione 3.6.1 in corso..." -ForegroundColor Yellow

$exclude = @('.git', '_VERSIONE_3.6.1_BASE', '_backup_v3.6.1_BASE.zip', 'ripristina_versione_3.6.1.ps1', 'ripristina_versione_3.6.1.bat', 'nuovo token github.txt')

Get-ChildItem -Path $baseDir | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
    $dest = Join-Path $currentDir $_.Name
    Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
    Write-Host "Ripristinato: $($_.Name)" -ForegroundColor Green
}

Write-Host "`nRipristino alla Versione 3.6.1 completato con successo!" -ForegroundColor Cyan
