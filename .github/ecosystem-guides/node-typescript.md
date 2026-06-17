---
title: "Node.js + TypeScript Patterns"
description: "Framework-specific guidance for Node.js APIs and backends"
version: "1.0"
---

## When to Load This Guide

✅ You're building a **Node.js backend or API** with TypeScript  
✅ You want **Node-specific patterns** for testing, errors, async  
✅ Complement with: Primary + essentials + this guide = ~7-8K tokens

---

## Testing Patterns in Node.js/Jest

### Unit Test
```typescript
// Use jest, mock dependencies
import { getUserById } from './users';
import * as db from './db';

jest.mock('./db');

describe('getUserById', () => {
  it('should return user from cache', async () => {
    (db.getUser as jest.Mock).mockResolvedValueOnce({ id: 1, name: 'Alice' });
    
    const user = await getUserById(1);
    
    expect(user.name).toBe('Alice');
  });
});
```

### Integration Test (Real Database)
```typescript
// Use jest + test database
describe('POST /api/users', () => {
  beforeEach(() => db.migrate.latest()); // Fresh schema
  
  it('should create user', async () => {
    const res = await request(app).post('/api/users').send({ name: 'Alice' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });
  
  afterEach(() => db.destroy());
});
```

**Coverage target:** >80%, focus on business logic not third-party integrations

---

## Error Handling in Node.js

### Express Middleware
```typescript
// Middleware to catch async errors
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/users/:id', asyncHandler(async (req, res) => {
  const user = await db.getUser(req.params.id);
  if (!user) throw new NotFoundError('User not found');
  res.json(user);
}));

// Error handler (last middleware)
app.use((err, req, res, next) => {
  logger.error('request_error', { error: err, path: req.path });
  
  if (err.status === 404) return res.status(404).json({ message: err.message });
  return res.status(500).json({ message: 'Internal error' });
});
```

### Async/Await (Not Callbacks)
```typescript
// ✅ Preferred: async/await
async function fetchUsers() {
  try {
    const users = await db.query('SELECT * FROM users');
    return users;
  } catch (err) {
    logger.error('db_error', { error: err.message });
    throw err;
  }
}

// ❌ Avoid: Callbacks (error-prone)
function fetchUsers(callback) {
  db.query('SELECT * FROM users', (err, users) => {
    if (err) return callback(err);
    callback(null, users);
  });
}
```

---

## Deployment: Docker + Node.js

### Dockerfile
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Health Check
```typescript
// GET /health for Kubernetes readiness probes
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };
  res.json(health);
});
```

---

## Security Patterns

### Input Validation (joi/zod)
```typescript
import { z } from 'zod';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().max(100)
});

app.post('/api/users', asyncHandler(async (req, res) => {
  const data = createUserSchema.parse(req.body); // Throws if invalid
  const user = await db.createUser(data);
  res.status(201).json(user);
}));
```

### Environment Variables
```typescript
// .env (never commit)
DATABASE_URL=postgresql://user:pass@localhost/db
JWT_SECRET=your-secret-key-here

// Load with dotenv
import dotenv from 'dotenv';
dotenv.config();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error('DATABASE_URL not set');
```

### No Hardcoded Secrets
```typescript
// ✅ Correct
const apiKey = process.env.STRIPE_API_KEY;

// ❌ Wrong
const apiKey = 'sk_live_abcd1234...'; // Never hardcode!
```

---

## Logging Best Practices

### Structured Logging
```typescript
import pino from 'pino';
const logger = pino();

// Info (routine operations)
logger.info({ userId, action: 'login' });

// Error (something broke, investigate)
logger.error({ error: err.message, stackTrace: err.stack, userId });

// Warn (concerning but recoverable)
logger.warn({ rateLimitRemaining: 10, endpoint: '/api/search' });
```

### Don't Log Secrets
```typescript
// ❌ Wrong
logger.info({ password: 'secret123' });

// ✅ Correct
logger.info({ userId: 123 }); // No sensitive data
```

---

## Database Patterns (Knex/Prisma)

### Migrations
```typescript
// 001_create_users.ts
export async function up(knex) {
  return knex.schema.createTable('users', (table) => {
    table.increments('id');
    table.string('email').unique();
    table.timestamps(true, true);
  });
}

export async function down(knex) {
  return knex.schema.dropTable('users');
}

// Run: npm run migrate:up
```

### Queries
```typescript
// Parameterized (not vulnerable to SQL injection)
const user = await knex('users').where('id', userId).first();

// With joins
const posts = await knex('posts')
  .join('users', 'posts.user_id', 'users.id')
  .select('posts.*', 'users.name');
```

---

## Recommended Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Runtime** | Node 18+ | LTS, stable |
| **Framework** | Express (simple) or Fastify (fast) | Lightweight |
| **Database** | PostgreSQL | ACID, relational, battle-tested |
| **Testing** | Jest | Easy, built-in coverage |
| **ORM** | Prisma (modern) or Knex (flexible) | Type-safe queries |
| **Validation** | Zod (simple) or Joi (feature-rich) | Catch bugs early |
| **Logging** | Pino (fast) or Winston | Structured, contextual |
| **Auth** | jsonwebtoken (JWT) | Stateless, scalable |

---

## When to Load Full Guides

- **Error handling:** Full guide for circuit breakers, cascading failures
- **Testing:** Full guide for mocking libraries, flaky test prevention
- **Deployment:** Full guide for CI/CD setup, Kubernetes, scaling
- **Security:** Full guide for OWASP Top 10, compliance

---

**Files:** `/ecosystem-guides/node-typescript.md`  
**Tokens:** ~2.5K (standalone, or ~1K additional loaded with essentials)  
**Best Used With:** Primary + essentials-only guides for Node-specific work
