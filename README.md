# Sentinel

The application behind the secret scanning platform: the API, the worker
and the operator console.

```
packages/core/     The scanner, the store, the rules, the crypto
apps/api/          The API and the worker
apps/console/      The operator console
```

The engine is gitleaks. It is not in this tree: the release is downloaded
at build time and checked against the checksum it publishes. See
`THIRD-PARTY-NOTICES.md`.

## The parts

**`packages/core`** holds everything the API and the worker share:

| Module | What it does |
| --- | --- |
| `scanner.ts` | Clones a repository and runs gitleaks over its history |
| `store.ts` | Every query the platform runs |
| `db.ts` | The pool and the schema |
| `crypto.ts` | The encryption of the credentials and the found secrets |
| `verifier.ts` | Asks a provider whether a secret still works |
| `honeytoken.ts` | Makes a decoy credential and matches it by its hash |
| `rules.ts` | Reads the rules that are in force out of gitleaks |
| `notify.ts` | Sends a finding to the webhooks |

**`apps/api`** is one image with two roles. `ROLE=api` serves the HTTP
API; `ROLE=worker` looks for secrets. They share the code and the
database, and nothing else.

**`apps/console`** is a static bundle: the browser loads the JavaScript
and every call goes to `/api`, which the console's own nginx forwards to
the API service. One origin, so there are no cross-origin concerns.

## Working on it

```sh
npm install
npm run build          # core, then the API, then the console
npm run typecheck
```

The console can be run against the fixtures, without a service behind it:

```sh
npm run build --workspace @sentinel/console
VITE_SENTINEL_USE_FIXTURES=1 npx vite build --outDir dist-fixtures
npx vite preview --outDir dist-fixtures
```

The fixtures are the API's shapes. A change to the API that the fixtures do
not follow shows up as a broken console in this mode, which is the point.

The API in development:

```sh
cd apps/api
DATABASE_URL=postgres://sentinel:sentinel@127.0.0.1:5432/sentinel \
ENCRYPTION_KEY=$(openssl rand -base64 32) \
OIDC_ISSUER=https://prysm.sh/oidc \
OIDC_AUDIENCE=https://sentinel.prysm.sh/api \
npm run dev
```

The schema is applied when the service starts. Every statement is
idempotent, so it can be run on a database that already has it.

## The environment

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | The Postgres connection string |
| `ENCRYPTION_KEY` | 32 bytes, base64. Encrypts the credentials and the found secrets. |
| `API_PORT` | The port the API listens on |
| `OIDC_ISSUER` | The provider the console signs in against |
| `OIDC_AUDIENCE` | The audience the token is minted for |
| `OIDC_AUDIENCES` | The other audiences a token may carry. The console's identity token carries the application's identifier as its audience. |
| `OIDC_OPERATOR_ROLE` | The role that makes a member an owner |
| `WORK_DIR` | Where the worker keeps its clones |
| `GITLEAKS_PATH` | The gitleaks binary |
| `GITLEAKS_CONFIG` | The rules every repository is scanned with |
| `SCAN_TIMEOUT_SECONDS` | How long a single scan may take |
| `ROLE` | `api` or `worker` |

## The tests

```sh
npm test --workspace @sentinel/api
```

The authenticator's tests run against a provider that is a few lines of
HTTP: it signs a token, and the test checks that the audience, the role and
the issuer are all enforced.

## Licence

AGPL-3.0 or a commercial licence. See `LICENSE` and `LICENSE-NOTICE.md`.
