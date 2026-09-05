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
# Signer preference: the publisher name that lands in the Digital Signatures
# tab. M. El-Ashry signs build 2.1 onward. It is SELF-SIGNED, so it does not
# remove the SmartScreen warning - only a CA-issued certificate does that.
#
# CN=ThePWF WellSim, O=ThePWF signed 1.3-2.0 and was the fallback here. Its
# certificate AND private key were deleted from the build machine on
# 5 Sep 2026 and the key was never exported, so the fallback could never match
# again - it is removed rather than left to look like an option. Those eight
# releases still verify: their signatures are embedded and timestamped, and
# ThePWF-CodeSigning.cer (public half) is kept for checking them.
$signerPreference = @('CN=M. El-Ashry')
$cert = $null
foreach ($subject in $signerPreference) {
  $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -eq $subject } | Select-Object -First 1
  if ($cert) { break }
}
if ($cert) {
  $s = Set-AuthenticodeSignature -FilePath build\WellSim.exe -Certificate $cert -TimestampServer "http://timestamp.digicert.com" -HashAlgorithm SHA256
  "signed with " + $cert.Subject + " (" + $s.Status + ")"
} else {
  "WARNING: none of these code-signing certs is in CurrentUser\My - exe left UNSIGNED: " + ($signerPreference -join '; ')
}
Copy-Item build\WellSim.exe .\WellSim.exe -Force
"Built: " + (Get-Item WellSim.exe).FullName + " (" + [math]::Round((Get-Item WellSim.exe).Length / 1MB, 1) + " MB)"
