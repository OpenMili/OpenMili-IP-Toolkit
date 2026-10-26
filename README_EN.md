# OpenMili-IP-Toolkit

Measure the real egress of your machine, configured HTTP/SOCKS proxy, or authorized SSH Agent. Public databases supplement actual HTTP/browser/DNS/TCP/TLS/traceroute observations. ASN names never prove residential access, and a successful homepage never guarantees registration or media playback.

With Node20+ and curl, use the same command in CMD, PowerShell or Bash:

```text
node -e "const c=require('child_process');c.execSync('npx --yes --allow-remote=root --package=https://github.com/OpenMili/OpenMili-IP-Toolkit/archive/refs/heads/main.tar.gz?openmili='+Date.now()+' openmili-ip',{stdio:'inherit'})"
```

The menu provides all checks, proxy port, individual modules, retry, report details and Chinese/English selection. Default website mode is HTTP; `websites --mode browser` or `all --browser` explicitly enables the isolated Playwright worker. Core checks have no browser dependency. `--no-install` forbids automatic dependency downloads.

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
