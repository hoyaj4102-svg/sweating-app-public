import { useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { usePageMeta } from "./meta";
import { validatePartnerInput, type PartnerInput } from "./partner-validation";
import "./visual.css";
import boxing from "../assets/demo/boxing.jpg";
import gymSpace from "../assets/brand/fitness-space.jpg";
import partnerPlank from "../assets/brand/partner-plank.jpg";

const BENEFITS = ["초기 입점비 무료", "새로운 고객에게 체육관 노출", "클래스 예약 기반 수익 기회", "클래스 및 참가자 관리", "정규 회원 전환 가능성"];
const SPORT_OPTS = ["러닝", "복싱", "헬스", "요가", "클라이밍", "테니스", "자전거", "수영", "서핑"];
const EMPTY: PartnerInput = { gymName: "", contactName: "", phone: "", email: "", region: "", address: "", sports: [], intro: "", website: "", consent: false };
const TEXT: [keyof PartnerInput, string, string][] = [
  ["gymName", "체육관 이름", "text"], ["contactName", "담당자 이름", "text"], ["phone", "연락처", "tel"], ["email", "이메일", "email"],
  ["region", "지역", "text"], ["address", "체육관 주소", "text"],
];

export function PartnersPage({ Shell }: { Shell: ComponentType<{ children: ReactNode }> }) {
  usePageMeta("체육관 파트너 | SWEATING", "체육관의 빈 시간을 새로운 매출 기회로. SWEATING 제휴 신청을 미리 체험해 보세요.");
  const [v, setV] = useState<PartnerInput>(EMPTY);
  const [errs, setErrs] = useState<Partial<Record<keyof PartnerInput, string>>>({});
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof PartnerInput>(k: K, val: PartnerInput[K]) => setV(p => ({ ...p, [k]: val }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = validatePartnerInput(v);
    setErrs(r);
    if (Object.keys(r).length) return;
    setV(EMPTY); setDone(true);
  };
  return (
    <Shell>
      <div className="vv vv-partners" data-testid="page-partners">
        <section className="vv-hero cm-partner-hero">
          <img src={boxing} alt="체육관에서 복싱을 함께 연습하는 두 사람" fetchPriority="high" />
          <div className="vv-hero-copy">
          <p className="vv-eyebrow">SWEATING PARTNERS / MOVE TO MEET.</p>
          <h1><span className="cm-l">체육관의 빈 시간을</span><b className="cm-l">새로운 매출 기회로.</b></h1>
          <p className="vv-desc">기존 시설과 프로그램으로 새로운 고객을 만나세요. SWEATING은 체육관의 운동 클래스를 새로운 만남과 수익의 기회로 연결합니다.</p>
          <a href="#partner-form" className="vv-btn" data-testid="link-partner-apply">무료 제휴 신청하기</a>
          </div>
        </section>
        <section className="vv-sec"><div className="vv-w">
          <p className="vv-eyebrow">PARTNER BENEFITS</p>
          <h2 className="vv-h2">파트너 혜택</h2>
          <img className="cm-photo cm-tall" src={gymSpace} alt="링과 스트랩이 걸린 어두운 체육관 공간" loading="lazy" />
          <ul className="vv-benefits">{BENEFITS.map(b => <li key={b}>{b}</li>)}</ul>
        </div></section>
        <section className="vv-sec alt vv-promise-sec" data-testid="section-partner-promise">
          <div className="vv-w">
            <div className="vv-promise-layout">
              <div className="vv-promise">
                <p className="vv-sub" data-testid="text-partner-promise-lead">관장님, 저희는<br />체육관의 빈 시간을<br />빌리는 게 아닙니다.</p>
                <div className="vv-body">
                  <p>평소 체육관에 올 이유가 없었던 남녀에게<br />운동할 이유와 새로운 사람을 만날 이유를<br />만들어 드리는 겁니다.</p>
                  <p>그리고 그 경험이 체육관의 잠재 고객과<br />신규 회원으로 돌아오게 만들겠습니다.</p>
                </div>
              </div>
              <img className="vv-promise-photo" src={partnerPlank} alt="체육관 바닥에서 나란히 플랭크를 하는 남녀" width={1024} height={646} loading="lazy" data-testid="img-partner-promise" />
            </div>
          </div>
        </section>
        <section className="vv-sec" id="partner-form"><div className="vv-w">
          <p className="vv-eyebrow">APPLY / DEMO</p>
          <h2 className="vv-h2">제휴 신청</h2>
          <p className="vv-note">입력한 내용은 저장되거나 서버로 전송되지 않습니다.</p>
          {done && <p className="vv-ok" role="status" data-testid="text-partner-success">제휴 신청 화면을 미리 체험했습니다. 현재는 데모 모드로 실제 신청이 접수되지 않습니다.</p>}
          <form className="vv-form" ref={formRef} onSubmit={submit} autoComplete="off" noValidate>
            {TEXT.map(([k, label, type]) => (
              <label key={k}>{label}
                <input type={type} autoComplete="off" value={v[k] as string} onChange={e => set(k, e.target.value as never)} aria-invalid={!!errs[k]} data-testid={`input-partner-${k}`} />
                {errs[k] && <span className="vv-err" role="alert">{errs[k]}</span>}
              </label>
            ))}
            <fieldset><legend style={{ marginBottom: 6 }}>운영 종목</legend>
              <div className="vv-checks">{SPORT_OPTS.map(s => <label key={s}><input type="checkbox" checked={v.sports.includes(s)} onChange={() => set("sports", v.sports.includes(s) ? v.sports.filter(x => x !== s) : [...v.sports, s])} />{s}</label>)}</div>
              {errs.sports && <span className="vv-err" role="alert">{errs.sports}</span>}
            </fieldset>
            <label>체육관 소개<textarea value={v.intro} onChange={e => set("intro", e.target.value)} data-testid="input-partner-intro" />{errs.intro && <span className="vv-err" role="alert">{errs.intro}</span>}</label>
            <label>SNS 또는 홈페이지 URL (선택)<input type="url" autoComplete="off" value={v.website} onChange={e => set("website", e.target.value)} data-testid="input-partner-website" />{errs.website && <span className="vv-err" role="alert">{errs.website}</span>}</label>
            <div>
              <label className="vv-consent"><input type="checkbox" checked={v.consent} onChange={e => set("consent", e.target.checked)} data-testid="input-partner-consent" style={{ width: 20, height: 20 }} />개인정보 수집 및 제휴 문의에 동의합니다.</label>
              {errs.consent && <span className="vv-err" role="alert">{errs.consent}</span>}
            </div>
            <button type="submit" className="vv-btn dark" data-testid="button-partner-submit">무료 제휴 신청하기</button>
          </form>
        </div></section>
      </div>
    </Shell>
  );
}
