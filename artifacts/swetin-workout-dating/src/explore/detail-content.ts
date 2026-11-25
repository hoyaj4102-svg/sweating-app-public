export type Tier = "social" | "premium";
export type DetailMeta = { tier: Tier; difficulty: string; beginner: string; refund: string };
export const TIER_LABEL: Record<Tier, string> = { social: "Social Class", premium: "Premium Class" };
export const UNKNOWN = "미제공";
export const POLICY_UNKNOWN = "정책 확인 필요";
export const SLOGAN = "MOVE TO MEET.";

const R_FREE = "무료 클래스 가정: 시작 전까지 자유롭게 취소할 수 있어요. 샘플 가정이며 공식 정책이 아닙니다.";
const R_SOC = "시작 24시간 전까지 전액 환불, 이후 환불 불가로 가정한 샘플 문구예요. 공식 요금·환불 정책이 아닙니다.";
const R_PRE = "시작 48시간 전까지 전액 환불, 24시간 전까지 50% 환불로 가정한 샘플 문구예요. 공식 정책이 아닙니다.";

/** Sample-only metadata keyed by demo class id. Business hypothesis, not an official tariff. */
export const DETAIL_META: Record<string, DetailMeta> = {
  "demo-sunset-run": { tier: "social", difficulty: "쉬움", beginner: "처음이어도 괜찮아요. 후미 러너가 함께합니다.", refund: R_FREE },
  "demo-boxing-basic": { tier: "social", difficulty: "쉬움", beginner: "입문자 전용 수업이에요. 장비 대여가 가능합니다.", refund: R_SOC },
  "demo-boxing-fit": { tier: "premium", difficulty: "어려움", beginner: "기초 동작을 아는 분께 권해요. 입문자는 첫걸음 클래스를 먼저 추천해요.", refund: R_PRE },
  "demo-bouldering": { tier: "social", difficulty: "보통", beginner: "입문자 환영. 안전 교육부터 시작합니다.", refund: R_SOC },
  "demo-tennis-rally": { tier: "premium", difficulty: "보통", beginner: "라켓을 잡아본 분이면 충분해요. 완전 초보는 사전 문의가 필요해요.", refund: R_PRE },
  "demo-yoga-flow": { tier: "social", difficulty: "쉬움", beginner: "초보자도 무리 없이 따라올 수 있어요.", refund: R_SOC },
  "demo-yoga-park": { tier: "social", difficulty: "쉬움", beginner: "처음 요가를 하는 분께 가장 편한 수업이에요.", refund: R_SOC },
  "demo-surf-lesson": { tier: "premium", difficulty: "보통", beginner: "서핑 첫 경험자 대상. 수영이 가능해야 해요.", refund: R_PRE },
};
