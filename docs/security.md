# Security policy

SaveTabs handles browser history (URLs and titles), optional account
credentials and end-to-end encrypted sync data. Please report suspected
security issues privately.

## Reporting a vulnerability

Email **support@azcom.dev** with:

- the affected component (extension, Worker API, web app, build pipeline),
- a short description and impact,
- reproduction steps or a proof of concept,
- the version and browser, when relevant.

Do not include real sync keys, passwords, service-account keys or other
people's browsing data in the report. Use synthetic values where possible.

Please do not open a public GitHub issue for a vulnerability before a fix has
been coordinated.

## Scope

In scope:

- the extension source and build artifacts,
- the sync Worker and its D1/R2-backed endpoints,
- the web app and account flows,
- release and CI configuration that could expose credentials.

Out of scope:

- social engineering,
- denial-of-service testing against production,
- issues that require a compromised browser profile or a rooted device,
- reports that only describe missing security headers without a concrete
  impact on SaveTabs.

## Handling

We aim to acknowledge reports within a few business days, reproduce the issue,
and coordinate a fix and disclosure timeline with the reporter. Credit is
given when requested.
