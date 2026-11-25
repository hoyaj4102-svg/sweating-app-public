import { Link } from "wouter";
import { ArrowUpRight, CalendarDays, MapPin, Users } from "lucide-react";
import type { ClassDetail } from "@workspace/api-client-react";
import { withCampaign } from "../visual-v2/campaign";
import { CapacityCompact } from "./CapacityViews";
import { getDemoCapacity } from "./demo-data";
import { ageBandLabel, joinEligibilityLabel, type EligibilityViewer } from "./age-band";
import { formatDateTime, formatPrice, slotState } from "./config";

export function ClassCard({ item, index, demo, from, back, viewer = null }: { item: ClassDetail; index: number; demo: boolean; from?: string; back?: string; viewer?: EligibilityViewer }) {
  const state = slotState(item);
  const cap = demo ? getDemoCapacity(item.id) : undefined;
  const base = `/classes/${encodeURIComponent(item.id)}${back ? `?back=${encodeURIComponent(back)}` : from ? `?from=${encodeURIComponent(from)}` : ""}`;
  const href = withCampaign(base, back?.split("?")[1] ?? "");
  return (
    <Link href={href} className="ex-card" style={{ ["--i" as string]: index }} data-testid={`card-class-${item.id}`} aria-label={`${item.title} 상세 보기`}>
      <div className="ex-card-media">
        {item.image_url ? <img src={item.image_url} alt="" loading="lazy" /> : <div className="ex-card-fallback">{item.sport_type}</div>}
        <span className="ex-chip">{item.sport_type}</span>
        {demo && <span className="ex-chip ex-chip-demo">샘플</span>}
        <span className={`ex-state ex-state-${state.tone}`}>{state.label}</span>
      </div>
      <div className="ex-card-body">
        <h3>{item.title}</h3>
        <p>{item.description || "소개가 아직 등록되지 않았어요."}</p>
        {cap && <CapacityCompact item={item} cap={cap} />}
        <ul>
          <li><CalendarDays size={14} />{formatDateTime(item.scheduled_at)}</li>
          <li><MapPin size={14} />{item.gym.name}</li>
          <li><Users size={14} />정원 {item.capacity}명 · 신청 {item.participant_count}명</li>
          <li data-testid={`text-class-age-band-${item.id}`}>{ageBandLabel(item.age_band)}</li>
          <li data-testid={`text-class-eligibility-${item.id}`}>{joinEligibilityLabel(item.age_band, viewer)}</li>
        </ul>
        <div className="ex-card-foot"><strong>{formatPrice(item.price)}</strong><span className="ex-go">자세히 <ArrowUpRight size={15} /></span></div>
      </div>
    </Link>
  );
}
