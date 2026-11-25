import { useSyncExternalStore } from "react";
import type { ClassDetail } from "@workspace/api-client-react";
import type { ProgramStep } from "./programs";
import { SEED_CAPACITY, type GenderCapacity } from "./capacity";
import { getCreated, getCreatedCapacity, subscribeDemo } from "./demo-store";
import heroRunner from "../../attached_assets/generated_images/hero-runner.jpg";
import boxing from "../assets/demo/boxing.jpg";
import boxingCoach from "../assets/demo/boxing-coach.jpg";
import climbing from "../assets/demo/climbing.jpg";
import tennis from "../assets/demo/tennis.jpg";
import yoga from "../assets/demo/yoga.jpg";
import yogaOutdoors from "../assets/demo/yoga-outdoors.jpg";
import surfing from "../assets/demo/surfing.jpg";

/** Sample-only content. Never merged into, or mistaken for, real API data. */
export type DemoExtra = {
  host: { name: string; role: string; bio: string };
  fullDescription: string[];
  meetingPoint: string;
  preparation: string[];
  cautions: string[];
  program: ProgramStep[];
  imageCredit: string;
};
export type DemoClass = { item: ClassDetail; extra: DemoExtra };

const at = (days: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

type Seed = {
  slug: string; title: string; sport: string; desc: string; days: number; hour: number; minute?: number;
  minutes: number; capacity: number; joined: number; price: number; image: string; venue: string; address: string;
  extra: DemoExtra;
};

const seeds: Seed[] = [
  { slug: "sunset-run", title: "샘플 선셋 러닝", sport: "러닝", desc: "해변을 따라 5km, 노을 속에서 함께 달리는 느린 러닝 모임.", days: 2, hour: 18, minutes: 70, capacity: 12, joined: 7, price: 0, image: heroRunner, venue: "샘플 · 예시 해변 광장", address: "예시시 (샘플 주소)",
    extra: { host: { name: "샘플 호스트 A", role: "러닝 크루 운영자 (가상)", bio: "페이스를 맞춰 달리는 걸 좋아하는 가상의 호스트입니다." }, fullDescription: ["기록보다 대화가 가능한 속도, 킬로미터당 6분 안팎으로 달립니다.", "처음 나온 사람도 중간에 걸어도 괜찮아요. 후미 러너가 끝까지 함께합니다.", "마무리 스트레칭 후 가볍게 물 한 잔 하며 인사를 나눠요."], meetingPoint: "예시 해변 중앙 광장 시계탑 앞 (샘플)", preparation: ["러닝화", "물 500ml", "가벼운 바람막이"], cautions: ["우천 시 하루 전 공지로 일정이 조정됩니다.", "무릎·발목에 통증이 있다면 코스를 줄여 주세요."], program: [{ title: "체크인 & 워밍업", description: "인사와 동적 스트레칭.", minutes: 10 }, { title: "해변 5km 러닝", description: "그룹 페이스로 왕복.", minutes: 40 }, { title: "쿨다운", description: "호흡 정리와 하체 스트레칭.", minutes: 20 }], imageCredit: "SWEATING 제공 이미지" } },
  { slug: "boxing-basic", title: "복싱 첫걸음 클래스", sport: "복싱", desc: "글러브 처음 끼는 사람을 위한 기본 자세와 원투 콤비네이션.", days: 3, hour: 19, minutes: 60, capacity: 8, joined: 6, price: 19900, image: boxing, venue: "샘플 · 예시 복싱짐", address: "예시시 (샘플 주소)",
    extra: { host: { name: "샘플 코치 B", role: "복싱 코치 (가상)", bio: "입문자 수업을 주로 맡는 가상의 코치입니다." }, fullDescription: ["스탠스, 가드, 잽과 크로스까지 거울 앞에서 천천히 익힙니다.", "샌드백 라운드는 짝과 번갈아 진행해 부담이 적습니다.", "접촉 스파링은 없습니다."], meetingPoint: "예시역 1번 출구 앞, 짐 입구 (샘플)", preparation: ["편한 운동복", "실내 운동화", "손 감싸는 밴디지(대여 가능)"], cautions: ["식후 1시간 이내 참여는 피해 주세요.", "손목 부상이 있으면 미리 알려 주세요."], program: [{ title: "스탠스 & 가드", description: "기본 자세 교정.", minutes: 15 }, { title: "원투 콤비네이션", description: "거울·미트 연습.", minutes: 25 }, { title: "샌드백 3라운드", description: "짝과 번갈아.", minutes: 15 }, { title: "정리 스트레칭", description: "어깨와 손목 풀기.", minutes: 5 }], imageCredit: "Pexels 6740336" } },
  { slug: "boxing-fit", title: "미트 & 샌드백 서킷", sport: "복싱", desc: "코치가 잡아주는 미트로 땀 흠뻑, 라운드 형식의 복싱 피트니스.", days: 5, hour: 20, minutes: 60, capacity: 10, joined: 10, price: 30000, image: boxingCoach, venue: "샘플 · 예시 복싱 스튜디오", address: "예시시 (샘플 주소)",
    extra: { host: { name: "샘플 코치 C", role: "피트니스 복싱 코치 (가상)", bio: "라운드 타이머로 리듬을 만드는 가상의 코치입니다." }, fullDescription: ["3분 라운드 6세트, 미트와 샌드백, 보디웨이트 서킷을 섞은 수업입니다.", "이미 정원이 찼지만 취소 자리가 생기면 표시가 바뀝니다 (샘플)."], meetingPoint: "예시 카페거리 입구 스튜디오 1층 (샘플)", preparation: ["수건", "물 700ml", "갈아입을 상의"], cautions: ["고강도 수업이에요. 심박이 불편하면 즉시 쉬세요."], program: [{ title: "라운드 워밍업", description: "줄넘기와 섀도.", minutes: 10 }, { title: "미트 3라운드", description: "코치와 일대일.", minutes: 20 }, { title: "서킷", description: "샌드백·보디웨이트.", minutes: 25 }, { title: "쿨다운", description: "호흡 정리.", minutes: 5 }], imageCredit: "Pexels 6740338" } },
  { slug: "bouldering", title: "볼더링 입문 & 루트 파인딩", sport: "클라이밍", desc: "홀드를 읽는 법부터 첫 완등까지, 작은 그룹으로 함께 오릅니다.", days: 4, hour: 19, minute: 30, minutes: 90, capacity: 8, joined: 3, price: 28000, image: climbing, venue: "샘플 · 예시 볼더링 센터", address: "예시시 (샘플 주소)",
    extra: { host: { name: "샘플 호스트 D", role: "클라이밍 동호인 (가상)", bio: "루트 세팅을 좋아하는 가상의 호스트입니다." }, fullDescription: ["초록·파랑 난이도 위주로 풀며 발 쓰는 법을 익힙니다.", "서로의 루트를 응원하는 분위기가 이 모임의 전부예요."], meetingPoint: "센터 1층 프런트 앞 (샘플)", preparation: ["클라이밍화(대여 가능)", "여분 양말", "초크 가방은 선택"], cautions: ["손바닥 피부가 약하면 테이핑을 가져오세요.", "착지 시 무릎을 굽히는 안전 교육을 먼저 받습니다."], program: [{ title: "안전 교육", description: "낙법과 규칙.", minutes: 15 }, { title: "스트레칭", description: "손목·어깨.", minutes: 10 }, { title: "루트 도전", description: "함께 풀기.", minutes: 55 }, { title: "정리", description: "후기 공유.", minutes: 10 }], imageCredit: "Pexels 7591305" } },
  { slug: "tennis-rally", title: "클레이코트 랠리 데이", sport: "테니스", desc: "실내 클레이코트에서 랠리와 복식 미니게임을 즐기는 시간.", days: 6, hour: 10, minutes: 90, capacity: 8, joined: 4, price: 39000, image: tennis, venue: "샘플 · 예시 실내 테니스장", address: "예시시 (샘플 주소)",
    extra: { host: { name: "샘플 코치 E", role: "테니스 코치 (가상)", bio: "랠리 지속 시간을 중시하는 가상의 코치입니다." }, fullDescription: ["포핸드·백핸드 랠리를 10개 이어가는 것이 첫 목표입니다.", "후반부는 복식 미니게임으로 자연스럽게 파트너를 바꿉니다."], meetingPoint: "코트 입구 라운지 (샘플)", preparation: ["테니스 라켓(대여 가능)", "코트화", "모자"], cautions: ["클레이 코트용 신발이 필요합니다.", "라켓 대여는 사전 문의가 필요해요."], program: [{ title: "워밍업", description: "미니 테니스.", minutes: 15 }, { title: "랠리 드릴", description: "크로스 랠리.", minutes: 35 }, { title: "복식 미니게임", description: "파트너 교체.", minutes: 35 }, { title: "정리", description: "스트레칭.", minutes: 5 }], imageCredit: "Pexels 5739120" } },
  { slug: "yoga-flow", title: "저녁 빈야사 플로우", sport: "요가", desc: "호흡에 맞춰 천천히 흐르는 60분, 하루의 긴장을 내려놓는 요가.", days: 1, hour: 20, minutes: 60, capacity: 14, joined: 9, price: 18000, image: yoga, venue: "샘플 · 예시 요가 룸", address: "예시시 (샘플 주소)",
    extra: { host: { name: "샘플 강사 F", role: "요가 강사 (가상)", bio: "호흡 중심 수업을 하는 가상의 강사입니다." }, fullDescription: ["태양경배를 기본으로 하는 부드러운 플로우입니다.", "동작을 무리해서 따라 하지 않아도 됩니다."], meetingPoint: "예시역 2번 출구 5분 거리 (샘플)", preparation: ["요가 매트(대여 가능)", "편한 복장", "물"], cautions: ["임신 중이거나 허리 부상이 있으면 미리 알려 주세요."], program: [{ title: "호흡 & 센터링", description: "자리 잡기.", minutes: 10 }, { title: "플로우", description: "태양경배와 균형.", minutes: 35 }, { title: "사바아사나", description: "이완.", minutes: 15 }], imageCredit: "Pexels 8391703" } },
  { slug: "yoga-park", title: "일요일 공원 요가 & 티타임", sport: "요가", desc: "야외에서 가볍게 몸을 늘리고, 끝나고 차 한 잔 나누는 모임.", days: 7, hour: 9, minutes: 75, capacity: 16, joined: 5, price: 12000, image: yogaOutdoors, venue: "샘플 · 시민공원 잔디광장", address: "예시시 (샘플 주소)",
    extra: { host: { name: "샘플 호스트 G", role: "요가 모임 운영자 (가상)", bio: "느린 일요일을 좋아하는 가상의 호스트입니다." }, fullDescription: ["잔디 위에서 하는 쉬운 스트레칭 요가와 명상으로 구성됩니다.", "끝난 뒤 티타임에서 자연스럽게 이야기 나눠요."], meetingPoint: "광장 분수대 앞 (샘플)", preparation: ["요가 매트", "얇은 담요", "선크림"], cautions: ["우천 시 취소됩니다.", "벌레 기피제를 챙겨 주세요."], program: [{ title: "체크인", description: "인사.", minutes: 10 }, { title: "스트레칭 요가", description: "전신 이완.", minutes: 40 }, { title: "티타임", description: "대화.", minutes: 25 }], imageCredit: "Pexels 13849044" } },
  { slug: "surf-lesson", title: "샘플 서핑 첫 파도", sport: "서핑", desc: "육상 교육 후 입수, 작은 파도에서 일어서기까지 도전합니다.", days: 8, hour: 8, minutes: 120, capacity: 6, joined: 4, price: 55000, image: surfing, venue: "샘플 · 예시 해수욕장", address: "예시시 (샘플 주소)",
    extra: { host: { name: "샘플 강사 H", role: "서핑 강사 (가상)", bio: "안전 교육을 가장 먼저 하는 가상의 강사입니다." }, fullDescription: ["패들링과 테이크오프를 모래 위에서 먼저 연습합니다.", "파도 상황이 위험하면 입수 없이 이론 수업으로 대체됩니다."], meetingPoint: "예시해변 서핑 안내소 앞 (샘플)", preparation: ["수영복", "래시가드", "수건과 갈아입을 옷"], cautions: ["수영이 전혀 불가능하면 참여할 수 없어요.", "기상에 따라 일정이 바뀔 수 있습니다."], program: [{ title: "안전 교육", description: "조류와 규칙.", minutes: 20 }, { title: "육상 연습", description: "패들링·테이크오프.", minutes: 30 }, { title: "입수", description: "작은 파도 도전.", minutes: 60 }, { title: "정리", description: "장비 정리.", minutes: 10 }], imageCredit: "Pexels 4784184" } },
];

export const demoClasses: DemoClass[] = seeds.map((s, index) => ({
  item: {
    id: `demo-${s.slug}`, gym_id: `demo-gym-${s.slug}`, title: s.title, sport_type: s.sport, description: s.desc,
    scheduled_at: at(s.days, s.hour, s.minute ?? 0), duration_minutes: s.minutes, capacity: s.capacity, price: s.price,
    image_url: s.image, status: "published", age_band: (["20_25", "26_35", "36_45"] as const)[index % 3], created_at: new Date(0).toISOString(),
    gym: { id: `demo-gym-${s.slug}`, name: s.venue, address: s.address, city: "예시시", created_at: new Date(0).toISOString() },
    participant_count: s.joined, remaining_slots: s.capacity - s.joined, is_joined: false,
  },
  extra: s.extra,
}));

let cache: { src: readonly DemoClass[]; merged: DemoClass[] } = { src: [], merged: demoClasses };
/** Stable snapshot: same array identity until a local sample is added. */
export const getDemoSnapshot = (): DemoClass[] => {
  const src = getCreated();
  if (cache.src !== src) cache = { src, merged: [...src, ...demoClasses] };
  return cache.merged;
};
export const useDemoClasses = () => useSyncExternalStore(subscribeDemo, getDemoSnapshot, getDemoSnapshot);
export const listDemoClasses = (sport?: string) => getDemoSnapshot().filter(c => !sport || c.item.sport_type === sport);
export const findDemoClass = (id: string) => getDemoSnapshot().find(c => c.item.id === id);
/** Sample-only capacity metadata; undefined for anything that is not a sample class. */
export const getDemoCapacity = (id: string): GenderCapacity | undefined => SEED_CAPACITY[id] ?? getCreatedCapacity(id);
