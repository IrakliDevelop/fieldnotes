# Security policy

## Supported versions

Before 1.0, security fixes are provided only for the latest published release of each Field Notes package. Consumers should keep the Field Notes package family within its declared peer dependency ranges.

## Reporting a vulnerability

Please report vulnerabilities privately through this repository's GitHub Security Advisories. Do not open a public issue for a security report.

## Dependency audit policy

Production dependencies block at moderate severity or above. Development dependencies block at high severity or above. Run `pnpm audit:ci` locally and in CI to enforce both checks.

Audit registry failures fail closed. There are currently no audit exceptions.

Any future exception must identify the CVE or advisory and dependency path, document reachability and mitigation, name an owner, expire within 30 days, and be reviewed in a dedicated pull request. Blanket or unbounded ignores are forbidden.

Dependabot checks npm dependencies and GitHub Actions weekly. Major tool migrations remain dedicated pull requests.
