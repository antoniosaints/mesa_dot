import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { useBlocker, type Blocker } from 'react-router';
const idle = {
  state: 'unblocked',
  reset: undefined,
  proceed: undefined,
  location: undefined,
} as Blocker;
const Context = createContext<{
  blocker: Blocker;
  owner: string | null;
  register: (id: string, fn: () => boolean) => () => void;
} | null>(null);
export function NavigationGuard({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, () => boolean>());
  const owner = useRef<string | null>(null);
  const register = useRef((id: string, fn: () => boolean) => {
    entries.current.set(id, fn);
    return () => {
      entries.current.delete(id);
    };
  }).current;
  const blocker = useBlocker(() => {
    const entry = [...entries.current].reverse().find(([, fn]) => fn());
    owner.current = entry?.[0] ?? null;
    return Boolean(entry);
  });
  return (
    <Context.Provider value={{ blocker, owner: owner.current, register }}>
      {children}
    </Context.Provider>
  );
}
export function useModalBlocker(shouldBlock: () => boolean): Blocker {
  const context = useContext(Context)!;
  const id = useId();
  const latest = useRef(shouldBlock);
  latest.current = shouldBlock;
  const register = context.register;
  useEffect(() => register(id, () => latest.current()), [id, register]);
  return context.owner === id ? context.blocker : idle;
}
