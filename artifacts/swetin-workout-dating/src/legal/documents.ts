export const LEGAL_DOCUMENT_VERSION = "2026-11-12";

export const DRAFT_BANNER =
  "법률 검토 전 초안입니다. 변호사 검토가 끝나기 전에는 효력이 있는 약관이나 개인정보 처리방침이 아닙니다.";

const operator = "서비스 운영자: [사업자 상호]. 대표자: [대표자]. 연락처: [연락처].";

export const termsSections = [
  {
    heading: "문서 상태",
    body: `${DRAFT_BANNER} 문서 버전은 ${LEGAL_DOCUMENT_VERSION}입니다. 상호, 대표자, 연락처, 보관 기간은 자리만 표시합니다.`,
  },
  {
    heading: "운영자",
    body: operator,
  },
  {
    heading: "서비스",
    body: "SWEATING은 운동 클래스에 함께 참여한 뒤에 프로필을 열고 관심을 표현할 수 있는 서비스의 초안 설명입니다. 구체적인 이용 조건, 결제, 금지 행위, 책임 제한은 법률 검토 후에 채웁니다.",
  },
  {
    heading: "계정",
    body: "이메일, 카카오 또는 Google로 가입할 수 있습니다. 이용약관, 개인정보 수집·이용, 개인정보 국외 이전은 각각 필수이며 국외 이전은 별도의 동의입니다. 회원은 프로필 설정에서 회원 탈퇴를 요청할 수 있습니다. 예정된 클래스가 있는 체육관 관장은 그 클래스를 정리하거나 권한을 넘긴 뒤에 탈퇴합니다.",
  },
] as const;

export const privacySections = [
  {
    id: "collection",
    heading: "수집·이용",
    body: `${DRAFT_BANNER} ${operator} 문서 버전은 ${LEGAL_DOCUMENT_VERSION}입니다. 초안이 적는 항목은 계정 식별자, 프로필(이름, 출생 연도, 운동, 관심사, 소개, 사진), 클래스 참가와 출석, 관심 표현과 매치, 동의 종류·버전·시각입니다. 이용 목적은 회원 식별, 클래스 운영, 운동 후 프로필 공개, 동의 이력 보관입니다. 보유 기간은 [N]입니다. 정확한 항목, 법적 근거, 파기 절차는 법률 검토 전입니다.`,
  },
  {
    id: "overseas",
    heading: "국외 이전",
    body: "개인정보는 Supabase Tokyo 리전에 저장합니다. 그 처리자는 Supabase Pte. Ltd.(싱가포르)입니다. 로그는 유럽연합 또는 미국에 있을 수 있습니다. 서비스 화면과 API는 Vercel Inc.(미국)가 호스팅합니다. 이전 항목, 이전 일시, 보유 기간 [N]는 법률 검토 후에 확정합니다. 이 이전은 개인정보 수집·이용 동의와 별도로 받습니다.",
  },
  {
    id: "rights",
    heading: "권리",
    body: "회원은 프로필에서 자신의 정보를 고치거나 회원 탈퇴로 계정 삭제를 요청할 수 있습니다. 열람, 정정, 삭제, 처리 정지의 구체적 절차와 법정 대리인 기준은 법률 검토 전입니다. 문의는 [연락처]로 둡니다.",
  },
] as const;

export function legalPlainText(): string {
  return [
    DRAFT_BANNER,
    ...termsSections.map((section) => `${section.heading} ${section.body}`),
    ...privacySections.map((section) => `${section.heading} ${section.body}`),
  ].join("\n");
}
