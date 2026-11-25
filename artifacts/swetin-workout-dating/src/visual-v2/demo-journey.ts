/** Pure fictional journey. No auth, API, account data or persistent storage. */
import { createDemoEnrollment, confirmDemoEnrollment, DEFAULT_DEMO_CLASS_ID, type DemoEnrollment } from "./demo-enrollment.ts";
import { createDemoMoneyState, getMatches, setWorkoutComplete, type DemoMoneyState } from "./demo-money.ts";

export type DemoChatMessage = { id: number; author: "me" | "demo"; text: string };
export type DemoJourney = {
  enrollment: DemoEnrollment | null;
  money: DemoMoneyState;
  workoutStarted: boolean;
  messages: Record<string, DemoChatMessage[]>;
};

const freshMoney = (classId: string): DemoMoneyState => ({ ...createDemoMoneyState(classId), liked: [] });
export function createDemoJourney(): DemoJourney {
  return { enrollment: null, money: freshMoney(DEFAULT_DEMO_CLASS_ID), workoutStarted: false, messages: {} };
}

export function selectDemoJourney(journey: DemoJourney, classId: string, returnTo: string | null): DemoJourney {
  const next = createDemoEnrollment(classId, returnTo);
  if (journey.enrollment?.classId === next.classId) {
    return journey.enrollment.returnTo === next.returnTo ? journey : { ...journey, enrollment: { ...journey.enrollment, returnTo: next.returnTo } };
  }
  return { enrollment: next, money: freshMoney(next.classId), workoutStarted: false, messages: {} };
}

export function joinDemoJourney(journey: DemoJourney): DemoJourney {
  const enrollment = confirmDemoEnrollment(journey.enrollment);
  return enrollment === journey.enrollment ? journey : { ...journey, enrollment };
}

export function startDemoWorkout(journey: DemoJourney): DemoJourney {
  return journey.enrollment?.joined ? { ...journey, workoutStarted: true } : journey;
}

export function completeDemoWorkout(journey: DemoJourney, completed: boolean): DemoJourney {
  if (!journey.enrollment?.joined || (completed && !journey.workoutStarted)) return journey;
  return { ...journey, workoutStarted: completed ? journey.workoutStarted : false, money: setWorkoutComplete(journey.money, completed) };
}

export function sendDemoChat(journey: DemoJourney, personId: string, rawText: string): DemoJourney {
  const text = rawText.trim();
  if (!journey.enrollment?.joined || !text || text.length > 500 || !getMatches(journey.money).some(p => p.id === personId && p.classId === journey.enrollment?.classId)) return journey;
  const previous = journey.messages[personId] ?? [];
  const next: DemoChatMessage[] = [
    ...previous,
    { id: (previous.at(-1)?.id ?? 0) + 1, author: "me", text },
    { id: (previous.at(-1)?.id ?? 0) + 2, author: "demo", text: "데모 자동응답: 함께 운동해서 반가워요! 이 대화는 가상이며 실제 상대에게 전달되지 않습니다." },
  ];
  return { ...journey, messages: { ...journey.messages, [personId]: next.slice(-40) } };
}
