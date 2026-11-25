export const DELETE_CONFIRMATION = "탈퇴";

export const GYM_OWNER_DELETE_COPY =
  "예정된 클래스가 있는 체육관의 관장은 탈퇴할 수 없어요. 예정된 클래스를 취소하거나, 운영자에게 관장 권한 이전을 요청한 뒤 다시 탈퇴해 주세요. 지난 클래스만 있으면 탈퇴할 수 있고, 그때 관장 연결은 사라지고 체육관과 지난 수업은 남습니다.";

export function deletionConfirmed(phrase: string): boolean {
  return phrase === DELETE_CONFIRMATION;
}
