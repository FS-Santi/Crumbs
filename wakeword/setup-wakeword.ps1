$ErrorActionPreference = "Stop"

$modelName = "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20"

$url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/$modelName.tar.bz2"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$modelRoot = Join-Path $scriptDir "model"

$archive = Join-Path $modelRoot "$modelName.tar.bz2"

$tarFile = Join-Path $modelRoot "$modelName.tar"

$finalDir = Join-Path $modelRoot $modelName

$keywordsFile = Join-Path $scriptDir "keywords.txt"


# ============================================================
# YOUR 7-ZIP LOCATION
# ============================================================

$sevenZip = "C:\ProgramData\chocolatey\tools\7z.exe"


# ============================================================
# VERIFY 7-ZIP
# ============================================================

if (-not (Test-Path $sevenZip)) {

    throw "7-Zip was not found at: $sevenZip"

}


Write-Host ""
Write-Host "Using 7-Zip:"
Write-Host $sevenZip
Write-Host ""


# ============================================================
# CREATE DIRECTORIES
# ============================================================

New-Item `
    -ItemType Directory `
    -Force `
    -Path $modelRoot `
    | Out-Null


# ============================================================
# CREATE CRUMBS KEYWORD FILE
# ============================================================

$keywordContents = "K R AH1 M Z :1.5 #0.25 @CRUMBS"

Set-Content `
    -Path $keywordsFile `
    -Value $keywordContents `
    -Encoding ASCII


Write-Host "Wake word file:"
Write-Host $keywordsFile

Write-Host ""
Write-Host "Wake word:"
Write-Host "CRUMBS"
Write-Host ""


# ============================================================
# CHECK WHETHER MODEL IS ALREADY INSTALLED
# ============================================================

$encoder = Join-Path `
    $finalDir `
    "encoder-epoch-13-avg-2-chunk-8-left-64.int8.onnx"


$decoder = Join-Path `
    $finalDir `
    "decoder-epoch-13-avg-2-chunk-8-left-64.onnx"


$joiner = Join-Path `
    $finalDir `
    "joiner-epoch-13-avg-2-chunk-8-left-64.int8.onnx"


$tokens = Join-Path `
    $finalDir `
    "tokens.txt"


$phoneFile = Join-Path `
    $finalDir `
    "en.phone"


if (
    (Test-Path $encoder) -and
    (Test-Path $decoder) -and
    (Test-Path $joiner) -and
    (Test-Path $tokens) -and
    (Test-Path $phoneFile)
) {

    Write-Host "Sherpa wake-word model is already installed."

    Write-Host ""
    Write-Host $finalDir

    Write-Host ""
    Write-Host "Everything is ready."
    Write-Host "Run:"
    Write-Host "  node index.js"

    exit 0
}


# ============================================================
# REMOVE INCOMPLETE EXTRACTED DIRECTORY
# ============================================================

if (Test-Path $finalDir) {

    Write-Host "Removing incomplete model directory..."

    Remove-Item `
        $finalDir `
        -Recurse `
        -Force

}


# ============================================================
# DOWNLOAD MODEL
# ============================================================

if (-not (Test-Path $archive)) {

    Write-Host "Downloading Sherpa wake-word model..."

    Invoke-WebRequest `
        -Uri $url `
        -OutFile $archive

} else {

    Write-Host "Using existing downloaded archive:"

    Write-Host $archive

}


# ============================================================
# VERIFY DOWNLOAD
# ============================================================

if (-not (Test-Path $archive)) {

    throw "Model download failed."

}


$archiveSize = (Get-Item $archive).Length


Write-Host ""
Write-Host "Downloaded archive size:"
Write-Host "$archiveSize bytes"
Write-Host ""


if ($archiveSize -lt 30000000) {

    throw "The downloaded archive looks incomplete. Delete it and run this script again."

}


# ============================================================
# REMOVE OLD TEMP TAR
# ============================================================

if (Test-Path $tarFile) {

    Remove-Item `
        $tarFile `
        -Force

}


# ============================================================
# STEP 1: BZ2 -> TAR
# ============================================================

Write-Host "Step 1 of 2:"
Write-Host "Decompressing BZ2 archive..."
Write-Host ""


& $sevenZip `
    x `
    $archive `
    "-o$modelRoot" `
    -y


if ($LASTEXITCODE -ne 0) {

    throw "7-Zip failed while decompressing the BZ2 archive."

}


if (-not (Test-Path $tarFile)) {

    throw "The TAR file was not created: $tarFile"

}


# ============================================================
# STEP 2: TAR -> MODEL DIRECTORY
# ============================================================

Write-Host ""
Write-Host "Step 2 of 2:"
Write-Host "Extracting model..."
Write-Host ""


& $sevenZip `
    x `
    $tarFile `
    "-o$modelRoot" `
    -y


if ($LASTEXITCODE -ne 0) {

    throw "7-Zip failed while extracting the TAR archive."

}


# ============================================================
# VERIFY MODEL DIRECTORY
# ============================================================

if (-not (Test-Path $finalDir)) {

    Write-Host ""
    Write-Host "Current model directory contents:"

    Get-ChildItem `
        -Force `
        $modelRoot

    throw "Extraction finished but the expected Sherpa model directory does not exist."

}


# ============================================================
# VERIFY REQUIRED FILES
# ============================================================

$requiredFiles = @(

    $encoder,

    $decoder,

    $joiner,

    $tokens,

    $phoneFile

)


foreach ($file in $requiredFiles) {

    if (-not (Test-Path $file)) {

        throw "Missing required model file: $file"

    }

}


# ============================================================
# SUCCESS
# ============================================================

Write-Host ""
Write-Host "=============================================="
Write-Host "SUCCESS"
Write-Host "=============================================="

Write-Host ""

Write-Host "Sherpa model installed:"
Write-Host $finalDir

Write-Host ""

Write-Host "Verified:"
Write-Host "  encoder"
Write-Host "  decoder"
Write-Host "  joiner"
Write-Host "  tokens.txt"
Write-Host "  en.phone"
Write-Host "  keywords.txt"

Write-Host ""


# ============================================================
# CLEAN TEMP FILES
# ============================================================

Write-Host "Removing temporary archives..."


if (Test-Path $archive) {

    Remove-Item `
        $archive `
        -Force

}


if (Test-Path $tarFile) {

    Remove-Item `
        $tarFile `
        -Force

}


Write-Host ""
Write-Host "Done."
Write-Host ""
Write-Host "Wake word: CRUMBS"
Write-Host ""
Write-Host "Next run:"
Write-Host "  node index.js"