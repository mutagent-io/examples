# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it through [GitHub's private vulnerability reporting](https://github.com/mutagent-io/examples/security/advisories/new)
on this repository, or email **security@mutagent.io**.

Please include what you found, how to reproduce it, and what an attacker could do with it. We will
acknowledge your report within three working days and keep you updated as we investigate.

## Scope

This repository holds example code. The examples are written to be read and copied, not to be run as
production services, and they are not part of any deployed system.

**In scope:**

- A credential, API key, or token committed anywhere in this repository or its history.
- Real customer data, personal data, or confidential material in an example or in a committed
  `.mutagent/` artifact.
- An example that teaches a materially insecure pattern a reader would plausibly copy into
  production — hardcoded secrets, disabled certificate verification, an injectable prompt or query.
- A supply-chain problem in an example's declared dependencies.

**Out of scope:**

- Vulnerabilities in MutagenT itself. Report those to security@mutagent.io, not here.
- Vulnerabilities in third-party frameworks an example imports. Report those upstream.
- An example failing to run, or a broken link. Open a normal issue for those.

## Handling secrets

Every entry in this repository is scanned before it is published:
`scripts/public-scrub/sweep.mjs` runs on every push and pull request, and gitleaks scans the full
history alongside it.

If you believe a live credential has been committed, treat it as compromised and report it
privately. Rotating the credential comes first; removing it from the repository comes second.
