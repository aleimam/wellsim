# WellSim portable build - produces a single standalone WellSim.exe
# Requires: Node 20.12+ (this exe was built from Node v24.20.0 - rebuilds swap the base binary to whatever node.exe is installed) and the dev tools (npm install --save-dev esbuild postject)
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force build | Out-Null
& node_modules\.bin\esbuild.cmd portable\main.js --bundle --platform=node --format=cjs --outfile=build\bundle.cjs
node --experimental-sea-config sea-config.json
Copy-Item "C:\Program Files\nodejs\node.exe" build\WellSim.exe -Force
& node_modules\.bin\postject.cmd build\WellSim.exe NODE_SEA_BLOB build\sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
# strip node.exe's stale signature pointer, then code-sign
node portable\strip-signature.js build\WellSim.exe
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like "*ThePWF WellSim*" } | Select-Object -First 1
if ($cert) {
  $s = Set-AuthenticodeSignature -FilePath build\WellSim.exe -Certificate $cert -TimestampServer "http://timestamp.digicert.com" -HashAlgorithm SHA256
  "signed with " + $cert.Subject + " (" + $s.Status + ")"
} else {
  "WARNING: no 'ThePWF WellSim' code-signing cert in CurrentUser\My - exe left unsigned"
}
Copy-Item build\WellSim.exe .\WellSim.exe -Force
"Built: " + (Get-Item WellSim.exe).FullName + " (" + [math]::Round((Get-Item WellSim.exe).Length / 1MB, 1) + " MB)"
