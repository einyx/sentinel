Prysm Sentinel
==============

Copyright (C) 2026 the Prysm Sentinel authors.

Sentinel is licensed under a dual licence. You may use it under either of
the two terms:

  * the GNU Affero General Public License, version 3 — see LICENSE for the
    full text; or

  * a commercial licence, available on request.

    Self-hosting Sentinel under the AGPL requires no licence fee and no
    negotiation. The commercial licence exists for deployments that do not
    want the AGPL's copyleft obligations to reach the code they expose over
    a network.

The AGPL was chosen over the GPL because Sentinel is server-side: the
obligation it adds, that a modified version offered over a network must
publish its source, is the one that matters for a service.

The whole of this tree is under that licence:

  packages/core/         The scanner, the store, the rules, the crypto
  apps/api/              The API and the worker
  apps/console/          The operator console

The engine is not part of this tree. Sentinel calls gitleaks, which is MIT
licensed and is downloaded at build time:

  gitleaks               The secret scanner. MIT. See THIRD-PARTY-NOTICES.md.

The parts that are meant to travel — the organisation's rules in
`../config/gitleaks.toml` and the CI workflow in `../ci/secret-scan.yml` —
carry no licence obligation of their own: they are configuration and a
workflow file, and they are meant to be copied into other repositories.
