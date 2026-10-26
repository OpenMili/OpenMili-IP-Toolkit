# Contributing

Use Node20+ and run `npm ci`, `npm test`, `npm run smoke`, `npm pack --dry-run`, `git diff --check`. Browser CI sets REQUIRE_BROWSER_TESTS=1 after installing Chromium. Network fixtures must use local servers or explicit documentation addresses, be identified as fixtures, and never fabricate public results.

Keep lookup, local, proxy and Agent paths separate. Unsupported checks must include an UNKNOWN/SKIPPED reason; do not silently change proxy, address family or source binding. Add behavioral regressions for substantive fixes and redact all output. Scoring changes need a versioned model, reproducible JSON input and explained coverage.

Endpoint/rule changes need source, update/expiry information and actual DNS/BGP or page evidence. ASN ownership is not geolocation or residential proof. Respect external service terms and dependency licenses; GPL directory terms remain separate. Do not contribute credentials, live reports or screenshots with personal information.

Portable bundle builds use the runner's trusted Node runtime; `runtime-manifest.json` records version/platform/architecture/hash/source commit. Publish only after native bundle verification and all required checks succeed.
