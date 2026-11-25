import { Link } from "wouter";
import { ArrowLeft, ShieldAlert } from "lucide-react";

export function PreviewUnavailable({ feature, hideActions = false }: { feature: string; hideActions?: boolean }) {
  return (
    <section className="ex-unavailable wrap" data-testid="screen-preview-unavailable">
      <ShieldAlert size={26} />
      <p className="eyebrow">SAMPLE PREVIEW</p>
      <h1>샘플 미리보기에서는<br />열 수 없어요.</h1>
      <p>{feature} 화면은 실제 데이터를 변경할 수 있어 샘플 모드에서 막아 두었어요. 클래스 둘러보기와 상세 확인만 가능합니다.</p>
      {!hideActions && <Link href="/home" className="button button-primary"><ArrowLeft size={15} /> 클래스 둘러보기</Link>}
    </section>
  );
}
