# OpenMili-IP-Toolkit

Measure the real egress of your machine, configured HTTP/SOCKS proxy, or authorized SSH Agent. Public databases supplement actual HTTP/browser/DNS/TCP/TLS/traceroute observations. ASN names never prove residential access, and a successful homepage never guarantees registration or media playback.

With Node.js 20+ (including npm) and curl, run the simple entry point in Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/simple-ip-check.ps1 | iex
```

Linux/macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/simple-ip-check.sh | sh
```

The two choices are start and custom proxy port. Both run the full engine: dual-stack egress, public ownership/type/risk sources (including the community ipapi.is source), DNS/PTR, routes, registration/BGP history, all 38 sites through raw HTTP, desktop headers and a real browser, and five-dimensional scoring. Family-specific echo hostnames avoid treating a proxy's preferred IPv6 response as a missing IPv4 exit. Windows supports these checks; it uses native ICMP tracert, while Linux traceroute can additionally measure TCP/UDP. HTTP/SOCKS proxies cannot carry remote return-route probes: run the script on the target VPS for those.

Remote runs prepare core dependencies in a temporary directory and clean it afterward. Browser checks prefer installed Edge/Chrome on Windows, then download Chromium if necessary; the isolated Playwright worker is cached in the user directory. Browser failure is shown as untested while other checks continue. The simple launcher displays all results in the terminal and creates no report files or screenshots by default. Green means passed, yellow means challenge or additional interaction, red means blocked or failed, and gray means unknown or skipped. Website tables compare all three methods with status codes, timings and detailed reasons; narrow terminals use stacked rows. Windows waits for Enter and preserves the calling shell. No system service is registered. Add `--save-report` or explicitly set `--output DIR` to the local simple Node launcher to also export report files.

For a local checkout, run `npm ci` and `node simple-ip-check.js`. The advanced CLI below retains separate module commands; its browser mode is opt-in with `all --browser` or `websites --mode browser`. `--no-install` disables browser dependency downloads.

```text
node bin/openmili.js all --language en --plain
node bin/openmili.js lookup --ip 8.8.8.8 --json
node bin/openmili.js port --host example.org --port 443 --tls
node bin/openmili.js websites --mode http --proxy socks5h://127.0.0.1:1080
node bin/openmili.js route --ipv6 --isp all
node bin/openmili.js score --input openmili-reports/latest.json --json
```

Independent RIPE/Cymru and official RIR RDAP sources supply ownership; licensed type evidence is fused with freshness, dependency deduplication and conflict disclosure. Reputation is independent from network type. DNS comparisons do not establish leakage or poisoning. Routes preserve real hops, anonymous responses, ASN and RTT; direction/geography must be verified separately. Proxy mode never substitutes local ICMP traces for proxy routes.

Five-dimensional scoring: reputation30 / websites25 / routes20 / DNS15 / network10. Unknown items are excluded from normalization and reduce coverage; below60% no overall grade is shown. Each report stores its model and normalized evidence for offline replay. Local outputs: JSON, single-file offline HTML, Markdown, TXT and ANSI. Reports are never uploaded. `--redact` masks IP/hostname, disables screenshots, and all output always removes credentials.

Native PowerShell and shell launchers share one Node core. Portable Releases include a runtime and SHA-256 checksums; installation/update/rollback/uninstall and platform limits are documented in [INSTALLATION](docs/INSTALLATION.md). Agent setup is in [AGENT](docs/AGENT.md). Full implementation and verification status: [DEVELOPMENT_PLAN](docs/DEVELOPMENT_PLAN.md).

Run `npm ci`, `npm test`, `npm run smoke`. Actual fixtures and live network evidence are recorded separately in docs/evidence. MIT applies to original code; see LICENSE and THIRD_PARTY_NOTICES for the separate GPL endpoint directory and bundled runtime/dependency licenses.
