export type ProgramStep = { title: string; description: string; minutes: number };

/** Known program outlines for real classes, matched by title. */
export const classPrograms: Record<string, ProgramStep[]> = {
  "선셋 러닝 클럽": [
    { title: "체크인 & 워밍업", description: "가볍게 몸을 풀고 러닝 페이스를 맞춰요.", minutes: 10 },
    { title: "샘플 5km 러닝", description: "해변을 따라 함께 달립니다.", minutes: 40 },
    { title: "쿨다운 스트레칭", description: "호흡을 정리하고 하체를 풀어줘요.", minutes: 10 },
  ],
  "사우스포 소셜": [
    { title: "몸풀기", description: "관절을 풀고 복싱 기본 자세를 익혀요.", minutes: 10 },
    { title: "기초 콤비네이션", description: "기본 펀치 조합을 천천히 연습해요.", minutes: 15 },
    { title: "미트 트레이닝", description: "코치와 짝을 이뤄 콤비네이션을 적용해요.", minutes: 35 },
    { title: "쿨다운 & 정리", description: "가볍게 스트레칭하며 오늘 동작을 정리해요.", minutes: 15 },
  ],
  "스트렝스 & 커피": [
    { title: "워밍업", description: "관절과 주요 근육을 깨워요.", minutes: 10 },
    { title: "전신 근력 운동", description: "45분 전신 운동 중 메인 세션을 진행해요.", minutes: 30 },
    { title: "쿨다운", description: "운동 후 호흡을 정리하고 스트레칭해요.", minutes: 5 },
    { title: "커피 & 대화", description: "근처 카페에서 여유롭게 이야기 나눠요.", minutes: 30 },
  ],
};
