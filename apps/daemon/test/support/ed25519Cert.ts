// A self-signed certificate for an Ed25519 key (openssl req -x509 -newkey
// ed25519): a key no Paperboard daemon has, which crypto.verify throws on
// when asked for ECDSA with SHA-256. Fixed here, since nothing in the
// runtimes makes an X.509 certificate.
export const ED25519_CERT = `-----BEGIN CERTIFICATE-----
MIIBCzCBvqADAgECAhQnx4tZEGdmN9iOkGzzEz3LLrPIFTAFBgMrZXAwDDEKMAgG
A1UEAwwBeDAeFw0yNjExMjgwOTEyMjhaFw0yNjExMjkwOTEyMjhaMAwxCjAIBgNV
BAMMAXgwKjAFBgMrZXADIQDGet01AgAsqai4fAgHbszzFj86WUz5+S8ksp7vAldN
s6MyMDAwHQYDVR0OBBYEFGIsnjr2rtGtht9A64RR40D22EsYMA8GA1UdEwEB/wQF
MAMBAf8wBQYDK2VwA0EAB3EbJsPCK5WTxJuwcp3XBqpy7ng2rjbDYYjvCDELwsHU
SMV7mcDyr2NDmj6g1+WckOI+E+DjDr5wdW6Ytk7VBg==
-----END CERTIFICATE-----
`;
