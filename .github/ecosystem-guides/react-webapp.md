---
title: "React Web App Patterns"
description: "Framework-specific guidance for React frontends"
version: "1.0"
---

## When to Load This Guide

✅ You're building a **React web application** (Next.js, CRA, Vite)  
✅ You want **React-specific patterns** for testing, state, components  
✅ Complement with: Primary + essentials + this guide = ~7.5-8.5K tokens

---

## Component Testing with React Testing Library

### Unit Test (Single Component)
```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';

describe('LoginForm', () => {
  it('should submit form when valid', async () => {
    render(<LoginForm onSubmit={jest.fn()} />);
    
    await userEvent.type(screen.getByPlaceholderText('Email'), 'alice@example.com');
    await userEvent.type(screen.getByPlaceholderText('Password'), 'pass123');
    await userEvent.click(screen.getByRole('button', { name: 'Login' }));
    
    // Assert side effect (component behavior, not implementation)
  });
  
  it('should show error for invalid email', async () => {
    render(<LoginForm />);
    await userEvent.type(screen.getByPlaceholderText('Email'), 'invalid');
    expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
  });
});
```

**Test behavior, not implementation.** Use `screen.getByRole` (accessible).

### Integration Test (API + Component)
```typescript
describe('UsersList', () => {
  beforeEach(() => {
    server.listen(); // Mock API server (MSW)
  });

  it('should fetch and display users', async () => {
    server.use(
      http.get('/api/users', () => HttpResponse.json([
        { id: 1, name: 'Alice' }
      ]))
    );
    
    render(<UsersList />);
    
    expect(await screen.findByText('Alice')).toBeInTheDocument();
  });
});
```

**Mock API with MSW, not individual fetch calls.**

---

## State Management Patterns

### Simple Component State (useState)
```typescript
// ✅ Good for local component state
function Counter() {
  const [count, setCount] = useState(0);
  
  return (
    <>
      <p>{count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </>
  );
}
```

### Context for Global State (Small Apps)
```typescript
// ✅ Good for 1-2 pieces of global state (theme, auth user)
const AuthContext = createContext<User | null>(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  
  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// Usage
function MyComponent() {
  const { user } = useContext(AuthContext);
}
```

### Zustand for Complex State (Mid-Size Apps)
```typescript
import { create } from 'zustand';

const useAuthStore = create((set) => ({
  user: null,
  token: null,
  login: async (email, password) => {
    const res = await fetch('/api/login', { /* ... */ });
    const { user, token } = await res.json();
    set({ user, token });
  },
  logout: () => set({ user: null, token: null })
}));

// Usage
function LoginButton() {
  const login = useAuthStore((state) => state.login);
}
```

**Rule:** Start with useState. Add Context for small globals. Zustand/Redux for complex state.

---

## API Calls & Data Fetching

### React Query / TanStack Query (Recommended)
```typescript
import { useQuery } from '@tanstack/react-query';

function UserProfile({ userId }) {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetch(`/api/users/${userId}`).then(r => r.json())
  });
  
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return <div>{user.name}</div>;
}
```

**Why React Query:** Caching, background refetch, automatic retries on error.

### Axios for Simple Cases
```typescript
import axios from 'axios';

useEffect(() => {
  axios.get(`/api/users/${userId}`)
    .then(res => setUser(res.data))
    .catch(err => setError(err.message));
}, [userId]);
```

---

## Error Handling in React

### Error Boundary (Catch Render Errors)
```typescript
class ErrorBoundary extends React.Component {
  componentDidCatch(error, info) {
    logger.error('component_error', { error, info });
  }
  
  render() {
    if (this.state.hasError) {
      return <div>Something went wrong. Reload to try again.</div>;
    }
    return this.props.children;
  }
}

// Usage
<ErrorBoundary>
  <UsersList />
</ErrorBoundary>
```

### User-Facing Errors (Toast/Alert)
```typescript
function LoginForm() {
  const [error, setError] = useState(null);
  
  const handleSubmit = async (email, password) => {
    try {
      await login(email, password);
    } catch (err) {
      setError('Invalid email or password'); // User-friendly, not "400 Bad Request"
    }
  };
  
  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {/* form */}
    </>
  );
}
```

---

## TypeScript Patterns

### Component Props
```typescript
interface ButtonProps {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

export function Button({ label, onClick, disabled, variant = 'primary' }: ButtonProps) {
  return <button onClick={onClick} disabled={disabled} className={variant}>{label}</button>;
}
```

### Custom Hooks with Types
```typescript
interface UseUserOptions {
  enabled?: boolean;
  retry?: number;
}

function useUser(userId: string, options?: UseUserOptions): {
  user: User | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  // implementation
}
```

---

## Performance Optimization

### useMemo (Prevent Re-renders of Expensive Calculations)
```typescript
const expensiveValue = useMemo(() => {
  return complexCalculation(data);
}, [data]); // Only recalc when `data` changes
```

### useCallback (Stable Function References)
```typescript
const handleClick = useCallback(() => {
  setCount(count + 1);
}, [count]); // Stable reference, won't cause child re-renders
```

### Code Splitting (Lazy Loading)
```typescript
const AdminPanel = lazy(() => import('./AdminPanel'));

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AdminPanel />
    </Suspense>
  );
}
```

---

## Common Anti-Patterns (Avoid)

🚫 **State in URL instead of component state**  
→ Use URL for filters/pagination, component state for UI (open/closed, etc.)

🚫 **Calling hooks conditionally**  
→ Hooks must be called at top level, always, in same order

🚫 **Missing dependencies in useEffect**  
→ ESLint rule will catch this. Always include all deps.

🚫 **Prop drilling** (passing props through 5+ components)  
→ Use Context or state management library

---

## Recommended Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Framework** | Next.js (full-stack) or Vite (SPA) | Full-featured or fast |
| **UI Framework** | Shadcn/ui, Tailwind | Accessible, customizable |
| **State** | Zustand (simple) or Redux (complex) | Scale with app complexity |
| **Data Fetch** | React Query (API) or SWR | Smart caching, retries |
| **Form** | React Hook Form | Lightweight, performant |
| **Testing** | Vitest + React Testing Library | Fast, accessible testing |
| **API Client** | Axios (JSON) or tRPC (TypeScript API) | Type-safe, simple |

---

## When to Load Full Guides

- **Testing:** Full guide for performance testing, E2E (Playwright)
- **Deployment:** Full guide for Next.js deployment, serverless
- **Architecture:** Full guide for advanced patterns (render props, compound components)
- **Security:** Full guide for XSS prevention, CSP, authentication

---

**Files:** `/ecosystem-guides/react-webapp.md`  
**Tokens:** ~2.5K (standalone, or ~1K additional loaded with essentials)  
**Best Used With:** Primary + essentials-only guides for React-specific work
