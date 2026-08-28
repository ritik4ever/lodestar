# Lodestar Backend

## Rate Limiting

The backend uses `express-rate-limit` for anti-spam protection on public write endpoints (e.g., `POST /reputation/:id`, `POST /agents/register`).

### Deployment Considerations

By default, rate limiting uses an in-memory store, which means limits are applied per process. When running multiple replicas behind a load balancer, the effective limit is multiplied by the number of replicas.

To enforce limits in aggregate across multiple instances, configure a shared Redis store by setting the `REDIS_URL` environment variable.

## On-chain write audit log

Every Soroban transaction the backend signs with its custodied key produces one
structured audit record (actor, contract function, arguments, tx hash, result,
request ID) on a stream separate from the application log. Configure it with
`AUDIT_LOG_ENABLED`, `AUDIT_LOG_FILE` and `AUDIT_LOG_LEVEL`. See
[`docs/audit-log.md`](../docs/audit-log.md) for the record schema, query
examples and retention policy.
