import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { likeDemo, spendDemo, topUpDemo, type DemoMoneyState, type DemoResult } from "./demo-money";
import {
  completeDemoWorkout, createDemoJourney, joinDemoJourney, selectDemoJourney, sendDemoChat, startDemoWorkout,
  type DemoJourney, type DemoChatMessage,
} from "./demo-journey";
import type { DemoEnrollment } from "./demo-enrollment";

type Result = { ok: boolean; state: DemoMoneyState; error?: string };
type Ctx = {
  enrollment: DemoEnrollment | null;
  state: DemoMoneyState;
  workoutStarted: boolean;
  messages: Record<string, DemoChatMessage[]>;
  selectClass: (classId: string, returnTo: string | null) => void;
  joinDemo: () => void;
  startWorkout: () => void;
  complete: (completed: boolean) => void;
  spend: (kind: "reveal" | "super", ids: string[]) => Result;
  topUp: (amount: number) => Result;
  like: (personId: string) => Result;
  sendMessage: (personId: string, text: string) => boolean;
  reset: () => void;
};
const DemoCtx = createContext<Ctx | null>(null);
export function useDemo() {
  const context = useContext(DemoCtx);
  if (!context) throw new Error("DemoMoneyProvider missing");
  return context;
}

/** One development-only SPA store. Reload resets it; never writes to auth or storage. */
export function DemoMoneyProvider({ children }: { children: ReactNode }) {
  const [journey, setJourney] = useState(createDemoJourney);
  const current = useRef(journey);
  const [path] = useLocation();
  const commit = useCallback((next: DemoJourney) => {
    current.current = next;
    setJourney(next);
  }, []);
  useEffect(() => {
    if (!path.startsWith("/preview/") && !path.startsWith("/classes/demo-")) commit(createDemoJourney());
  }, [path, commit]);
  const run = useCallback((fn: (state: DemoMoneyState) => DemoResult): Result => {
    // Ref update is synchronous: rapid clicks cannot debit a stale balance twice.
    const snapshot = current.current;
    if (!snapshot.enrollment?.joined) return { ok: false, state: snapshot.money, error: "not-enrolled" };
    const result = fn(snapshot.money);
    if (result.ok) commit({ ...snapshot, money: result.state });
    return result;
  }, [commit]);
  const value = useMemo<Ctx>(() => ({
    enrollment: journey.enrollment,
    state: journey.money,
    workoutStarted: journey.workoutStarted,
    messages: journey.messages,
    selectClass: (id, ret) => commit(selectDemoJourney(current.current, id, ret)),
    joinDemo: () => commit(joinDemoJourney(current.current)),
    startWorkout: () => commit(startDemoWorkout(current.current)),
    complete: completed => commit(completeDemoWorkout(current.current, completed)),
    spend: (kind, ids) => run(state => spendDemo(state, kind, ids)),
    topUp: amount => run(state => topUpDemo(state, amount)),
    like: id => run(state => likeDemo(state, id)),
    sendMessage: (id, text) => {
      const previous = current.current;
      const next = sendDemoChat(previous, id, text);
      if (next === previous) return false;
      commit(next);
      return true;
    },
    reset: () => commit(createDemoJourney()),
  }), [journey, commit, run]);
  return <DemoCtx.Provider value={value}>{children}</DemoCtx.Provider>;
}
