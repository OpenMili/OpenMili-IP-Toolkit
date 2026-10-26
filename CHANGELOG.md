# Changelog

## 2.4.2

- Isolate browser cancellation and no-install regression fixtures so parallel Node 20/24 integration tests cannot interfere with one another.


## 2.4.1

- Fix Windows portable self-uninstall: start an independent hidden cleanup process and confirm readiness before returning. Native and public-installer checks now uninstall through the installed launcher and verify user-file preservation.
- Retain IPv4 routes, interfaces and DNS details when another Windows system query is unavailable.
- Honor no-install/offline flags for an existing browser worker and close browsers cancelled during startup before any egress request.

## 2.4.0

- Optional browser worker, default HTTP mode and independent browser egress checks.
- Authorized SSH Agent with strict host-key verification.
- Portable runtime bundles, SHA-256 installation, update with retained versions, rollback and owned-resource uninstall.
- Native architecture release checks, musl core checks, dependency audit and English documentation.

## 2.3.0

- Reproducible configurable five-dimensional scoring, coverage threshold and offline replay.
- Chinese/English interactive menu, retry, narrow/plain output and elapsed progress.
- Offline HTML theme/charts/hop evidence/embedded screenshots; Markdown/TXT/ANSI exports.

## 2.2.0

- Sourced dual-stack operator directory, verified ownership, real protocol traces and health history.
- Complete anonymous hops/RTT/ASN, direction warnings and versioned 38-site rules.

## 2.1.0

- Independent RIPE/Cymru/official RDAP evidence; DNS UDP/TCP/DoH/DoT; scoped provider cache/retry/offline behavior.

## 2.0.x

- Isolated lookup/port/system commands, strict binding, schema and privacy filtering.
