# Test-only TLS credentials

`dns-cert.pem` and `dns-key.pem` are public, disposable localhost fixture credentials. They are only trusted by the local DoT integration test through its explicit CA option. They are never used by the application, installed into a trust store, or deployed.

Generated with OpenSSL: `req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=localhost -addext subjectAltName=DNS:localhost -keyout dns-key.pem -out dns-cert.pem`.
