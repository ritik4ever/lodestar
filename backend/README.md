# Lodestar Backend

## Rate Limiting

The backend uses `express-rate-limit` for anti-spam protection on public write endpoints (e.g., `POST /reputation/:id`, `POST /agents/register`).

### Deployment Considerations

By default, rate limiting uses an in-memory store, which means limits are applied per process. When running multiple replicas behind a load balancer, the effective limit is multiplied by the number of replicas.

To enforce limits in aggregate across multiple instances, configure a shared Redis store by setting the `REDIS_URL` environment variable.
