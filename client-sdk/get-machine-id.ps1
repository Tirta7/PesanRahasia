# Membaca Hardware UUID / Machine ID pada Windows untuk Lisensi VOC ML
$ErrorActionPreference = "SilentlyContinue"
$uuid = (Get-CimInstance -Class Win32_ComputerSystemProduct).UUID
if (-not $uuid) {
    $uuid = (Get-WmiObject -Class Win32_ComputerSystemProduct).UUID
}
if (-not $uuid -or $uuid -eq "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF") {
    $uuid = (Get-CimInstance -Class Win32_BIOS).SerialNumber
}
Write-Output $uuid.Trim()
