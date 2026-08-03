---
name: modern-full-stack
description: Modern full-stack development guide covering backend APIs, databases, caching, message queues, and deployment. Use for backend development, API design, database architecture, caching strategies, distributed systems, and full-stack integration.
tags: [full-stack, backend, api-design, rest-api, graphql, database, caching, redis, kafka, rabbitmq, message-queues, deployment, cloud, microservices, architecture, node-js, python, golang, rust]
license: MIT
author: Konoha Team
version: 1.0.0
---

# Modern Full-Stack Development

## Technology Stack Overview

### Backend Languages
- **Node.js**: Event-driven, non-blocking I/O, great for I/O-heavy apps
- **Python**: Data science, ML, rapid prototyping, async support
- **Go**: High performance, concurrent, simple deployment
- **Rust**: Memory safety, performance, systems programming
- **PHP**: Web-specific, Laravel ecosystem
- **Ruby**: Developer experience, Ruby on Rails

### Databases

#### Relational (SQL)
| Database | Best For | Key Features |
|----------|----------|--------------|
| PostgreSQL | General purpose, complex queries | JSONB, full-text search, extensions |
| MySQL/MariaDB | Web apps, CRUD operations | Widely supported, mature |
| SQLite | Local apps, prototyping | Zero config, file-based |
| Oracle | Enterprise, legacy systems | Advanced features, support |

#### NoSQL
| Database | Best For | Key Features |
|----------|----------|--------------|
| MongoDB | Document storage, flexible schema | Scale-out, aggregation pipeline |
| Redis | Caching, sessions, pub/sub | In-memory, persistence options |
| Cassandra | High write throughput, time-series | Linear scalability, multi-datacenter |
| Elasticsearch | Full-text search, log analysis | Inverted index, aggregations |
| DynamoDB | Serverless, low-latency | Managed, auto-scaling |

### Caching Strategies

#### Cache-Aside (Lazy Loading)
```python
def get_user(user_id):
    cache_key = f"user:{user_id}"
    user = redis.get(cache_key)
    if user:
        return deserialize(user)
    
    user = db.query("SELECT * FROM users WHERE id = ?", user_id)
    if user:
        redis.setex(cache_key, TTL, serialize(user))
    return user
```

#### Write-Through
```python
def update_user(user_id, data):
    result = db.update(user_id, data)
    redis.set(f"user:{user_id}", serialize(result))
    return result
```

#### Eviction Policies
- **LRU**: Least Recently Used (Redis default)
- **LFU**: Least Frequently Used
- **TTL**: Time-To-Live expiration
- **Random**: Random eviction

### Message Queues

#### Kafka
- High-throughput, distributed streaming
- Persistent log-based storage
- Event sourcing, CDC
- Use for: Event streaming, log aggregation, metrics

#### RabbitMQ
- Traditional message broker
- AMQP protocol, rich routing
- Use for: Task queues, RPC, event routing

#### Redis Streams
- Simple pub/sub with persistence
- Use for: Simple event pipelines, command queue

### API Design

#### REST API Guidelines
- Use proper HTTP methods (GET, POST, PUT, PATCH, DELETE)
- Version APIs (/v1/, /v2/)
- Consistent naming conventions
- Proper status codes (2xx, 4xx, 5xx)
- Pagination for collections
- Filtering and sorting parameters

#### GraphQL Guidelines
- Define clear schema
- Use resolvers for data fetching
- Implement DataLoader for N+1 prevention
- Support pagination with cursors
- Consider fragmentation (queries + fragments)

#### API Security
- Authentication (JWT, OAuth2, API keys)
- Rate limiting
- Input validation
- CORS configuration
- HTTPS only
- Security headers

## Architecture Patterns

### Monolith
- Single deployment unit
- Shared database
- Simpler debugging
- Scale vertically

### Microservices
- Independent deployment
- Service discovery
- API gateway
- Event-driven communication
- Distributed tracing

### Event-Driven Architecture
- Event sourcing
- CQRS (Command Query Responsibility Segregation)
- Saga pattern
- Outbox pattern
- Dead letter queues

### Serverless
- Function-as-a-Service (AWS Lambda, Cloud Functions)
- API Gateway
- Event triggers
- Cold start considerations

## Deployment Strategies

### Containers
- Docker for packaging
- Kubernetes for orchestration
- Helm for package management
- Service mesh (Istio, Linkerd)

### Infrastructure as Code
- Terraform for cloud resources
- Pulumi for multi-language
- AWS CDK for AWS
- Ansible for configuration

### CI/CD
- GitHub Actions, GitLab CI, Jenkins
- Build, test, security scan
- Automated deployment
- Blue-green, canary releases

## Performance Optimization

### Database
- Index optimization
- Query optimization
- Connection pooling
- Read replicas
- Partitioning

### Caching
- Multi-level caching
- Cache warming
- Cache invalidation strategies
- CDN for static assets

### Application
- Connection pooling
- Async operations
- Batch processing
- Compression
- Lazy loading

## Testing Strategies

### Unit Tests
- Isolated business logic
- Mock external dependencies
- > 80% coverage target

### Integration Tests
- Database interactions
- API endpoints
- External service calls

### E2E Tests
- Critical user flows
- Browser automation
- Performance testing

## Security Checklist

- [ ] Input validation on all endpoints
- [ ] Authentication and authorization
- [ ] SQL injection prevention
- [ ] XSS prevention
- [ ] CSRF protection
- [ ] Secrets management
- [ ] HTTPS everywhere
- [ ] Security headers
- [ ] Dependency scanning
- [ ] Regular security audits

## Common Pitfalls

1. **N+1 Queries**: Always check query count
2. **Missing Indexes**: Analyze query plans
3. **No Caching**: Cache expensive operations
4. **Tight Coupling**: Use interfaces, DI
5. **No Error Handling**: Graceful degradation
6. **Hardcoded Secrets**: Use vault/env vars
7. **No Rate Limiting**: Protect against abuse
8. **Missing Monitoring**: Observability is key

## References

- [REST API Best Practices](https://restfulapi.net/)
- [Database Design Patterns](https://www.enterpriseintegrationpatterns.com/)
- [Redis Commands](https://redis.io/commands/)
- [Kafka Documentation](https://kafka.apache.org/documentation/)
