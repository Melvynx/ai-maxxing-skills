# TanStack Start safety audit checklist

Use this checklist to guide inspection, not as boilerplate for the final answer.

## 1. Surface inventory

Find every server-reachable operation in the scoped feature:

- TanStack file routes and parent layouts;
- `beforeLoad`, loaders, server route handlers, and request middleware;
- `createServerFn`, server-only functions, actions, and RPC wrappers;
- REST/API compatibility routes, MCP/tool endpoints, webhooks, callbacks, cron jobs,
  queues, and background workers;
- shared data helpers called by those surfaces;
- public DTOs, cache keys, redirects, file upload/download, and signed URLs.

Search by route segment, feature directory, exported function names, ORM model names,
and call sites. Generated route trees can confirm reachability but are not the source
of authorization policy.

## 2. Access matrix

For every read and mutation, answer independently:

| Boundary | Required evidence |
| --- | --- |
| Authentication | Session, API token, provider signature, or deliberate public access |
| Tenant | Requested tenant is derived from or checked against the actor's membership/token |
| Resource | Resource belongs to that same tenant in the authoritative query |
| Ownership | User-owned records are scoped by authenticated user ID where required |
| Role | Coarse role allows the operation |
| Permission | Fine-grained capability matches the operation, especially mutations |
| Token scope | Read/write/tool scope is enforced server-side |
| State | Resource state permits the transition and replay is safe |

Treat IDs from params, search, form data, JSON, headers, cookies, and metadata as
attacker-controlled until bound server-side.

## 3. TanStack-specific traps

- A parent route `beforeLoad` protects route rendering, not direct calls to imported
  server functions or API endpoints.
- A child route may be reachable outside the visual layout through generated routes,
  redirects, preloads, or direct server-function calls. Verify the actual route tree.
- `createServerFn` is a public network boundary unless its handler enforces deliberate
  public access, authentication, or stronger authorization.
- Require input validation before authorization logic consumes IDs or discriminators.
- Middleware context is safe only if the handler uses the identity and tenant from
  that context. Compare it with any tenant ID carried in input.
- Request middleware and function middleware are different surfaces; verify the right
  middleware type is attached to the right entry point.
- Client-only role checks, conditional components, disabled controls, and navigation
  redirects do not protect data or mutations.
- Error serialization must not expose ORM, SQL, stack, secrets, internal URLs, or
  existence differences that create a useful cross-tenant oracle.

## 4. Query and mutation binding

Prefer one authoritative, scoped query such as:

```ts
where: {
  id: resourceId,
  tenantId: authorizedTenantId,
  ownerId: authenticatedUserId,
}
```

Check all nested and follow-up operations. Common failures:

- fetching by global `id`, checking tenant, then later updating/deleting by `id` only;
- checking a parent but loading a child without parent or tenant scope;
- accepting a `tenantId`, `userId`, role, price, status, or ownership field from the
  client when it should be derived from trusted context;
- authorization against one tenant while the ORM query uses another tenant from data,
  cookie, URL, or metadata;
- batch operations where one authorized item permits unscoped IDs in the rest;
- `connect`, `set`, `upsert`, relation filters, raw SQL, or dynamic identifiers that
  cross the established boundary;
- TOCTOU state changes, replayable transitions, or non-idempotent provider callbacks.

For public reads, require explicit field selection and a deliberate DTO. Inspect
transitive helpers for credentials, tokens, customer IDs, private metadata, internal
webhooks, deleted records, drafts, or PII.

## 5. Endpoint classes

### Session APIs and server functions

- Validate method and input.
- Enforce auth in the server boundary itself.
- Bind actor, tenant, resource, role, and permission.
- Consider CSRF/origin defenses for cookie-authenticated mutations according to the
  framework and repository's actual deployment.
- Do not accept an actor identity from request data.

### API tokens and tools

- Parse the exact supported authorization scheme; reject malformed variants.
- Verify token hash/status/expiry/revocation as implemented by the repository.
- Derive tenant from token, then scope every resource to it.
- Enforce read versus write and per-tool scopes before dispatch.
- Prevent a tool name, path param, or nested input from escaping the allowed registry.
- Keep logs and errors free of bearer-token values.

### Webhooks and callbacks

- Read the raw body with a size limit when signature verification requires it.
- Verify signature/secret, timestamp tolerance where supported, and provider/account
  identity before side effects.
- Handle replay and duplicate delivery idempotently.
- Bind provider metadata to local tenant/resource state; do not trust metadata alone.
- Fail closed on missing or ambiguous local records.

### Uploads, downloads, and external URLs

- Validate type, size, extension/content mismatch, key/path ownership, and tenant.
- Scope signed URLs and storage keys; prevent path/key traversal and overwrite.
- For outbound fetches, restrict protocols, hosts, redirects, and private-network
  destinations as needed; set time and size limits.

## 6. Other safety checks

- Sensitive mutations need the narrowest permission, not merely broad team membership.
- Role hierarchy and permission-group expansion must match product intent.
- Cache keys and invalidation must include tenant/user/resource dimensions used by the
  authorization decision; never cache one actor's result for another.
- Redirect and callback URLs need an allowlist or safe relative-path policy.
- Pagination, search, counts, exports, and analytics must retain tenant filters.
- Logs, analytics, error reports, and audit records must not expose secrets or full
  sensitive request bodies.
- Rate-limit auth, enumeration, expensive AI, upload, and externally billable actions
  where abuse has meaningful impact.
- Public metadata, sitemaps, Open Graph handlers, docs, and health routes must not
  enumerate private tenants or resources.

## 7. Regression evidence

Recommend focused tests that can fail before the fix:

- anonymous actor;
- authenticated user from another tenant;
- same-tenant actor with insufficient role or permission;
- valid actor with a resource ID from another tenant;
- valid actor attempting to act on another user;
- read-only token calling a mutation;
- token from tenant A naming a resource from tenant B;
- invalid or replayed webhook signature/event;
- valid happy path.

Static unit tests for permission maps are useful but do not prove endpoint wiring. When
authorized and practical, add request-level or server-function tests that exercise the
real middleware and scoped query. Keep static, local runtime, deployment, and live
authenticated evidence as separate claims.
