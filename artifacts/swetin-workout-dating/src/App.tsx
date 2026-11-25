import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, Route, Switch, Router as WouterRouter, useLocation, useRoute } from "wouter";
import { useSearch as useRawSearch } from "wouter/use-browser-location";
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, ChevronRight, Dumbbell, Heart, MapPin, Users } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { acceptAccountConsents, completeClass, getCurrentUser, getBlindWorkout, getClass, getMyActivity, getRevealedParticipants, joinClass, likeParticipant, listMatches, logIn, logOut, saveMyProfile, signUp } from "@workspace/api-client-react";
import { profilePhotoFileError, uploadProfilePhoto } from "@/profile/upload-photo";
import { ForgotPasswordScreen, RecoveryLinkRedirect, ResetPasswordScreen } from "@/auth/password-reset";
import { userFacingMessage } from "@/auth/user-message";
import { passwordPolicyMessage, validateNewPassword } from "@workspace/password-policy";
import type { Activity, AuthSession, ClassDetail, Gym, MatchSummary, ProfileInput, PublicParticipantProfile, RevealedParticipantsResponse } from "@workspace/api-client-react";
import { ExploreHome } from "@/explore/ExploreHome";
import { ClassDetailPage } from "@/explore/ClassDetailPage";
import { PreviewUnavailable } from "@/explore/PreviewUnavailable";
import { isClassDemoMode, isUxDemoMode } from "@/explore/config";
import { DemoMoneyProvider } from "@/visual-v2/DemoContext";
import "@/visual-v2/journey-pages.css";
import { AboutPage } from "@/visual-v2/AboutPage";
import { PartnersPage } from "@/visual-v2/PartnersPage";
import { StartPage } from "@/visual-v2/StartPage";
import { Brand, SiteHeader } from "@/shell/site-header";
import { GymDesk } from "@/admin/GymDesk";
import { OwnerNotices } from "@/admin/OwnerNotices";
import { MessagesPage } from "@/messages/MessagesPage";
import { MatchChatPage } from "@/messages/MatchChatPage";
import { PrinciplesGate } from "@/messages/PrinciplesGate";
import { OwnerScreen } from "@/owner/OwnerScreen";
import { SiteFooter } from "@/shell/site-footer";
import { ConsentFields } from "@/legal/ConsentFields";
import { PrivacyPage, TermsPage } from "@/legal/LegalPages";
import { EMPTY_CONSENT, consentReady, needsConsentGate, type ConsentChoice } from "@/legal/consent";
import { DeleteAccountPanel } from "@/account/DeleteAccountPanel";
import { DemoSurface } from "@/visual-v2/DemoPages";
import { SampleCapacitySettings } from "@/explore/SampleCapacitySettings";
import { classProfileUrl, parseClassReturn } from "@/explore/auth-return";
import { AGE_BANDS, ageBandForBirthYear, ageBandLabel, birthYearBounds, isAgeBand, type AgeBand } from "@/explore/age-band";
import { oauthErrorFromSearch, socialLoginButtons } from "@/auth/social-login";
import "@/campaign-marketing.css";
import heroRunner from "../attached_assets/generated_images/hero-runner.jpg";

const queryClient = new QueryClient();
const sports = ["러닝", "복싱", "근력 운동", "요가"];
const interests = ["커피", "음악", "여행", "사진", "요리", "등산"];

type AuthValue = {
  session: AuthSession | null;
  loading: boolean;
  setSession: (session: AuthSession | null) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);
const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
};

function errorMessage(error: unknown, fallback = "잠시 후 다시 시도해 주세요.") {
  return userFacingMessage(error, fallback);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try {
      setSession(await getCurrentUser());
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);
  const signOut = async () => {
    try { await logOut(); } finally { setSession(null); window.location.href = "/"; }
  };
  const value = useMemo(() => ({ session, loading, setSession, refresh, signOut }), [session, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Header() {
  const { session, signOut } = useAuth();
  return <SiteHeader session={session} signOut={signOut} showClassDemo={isClassDemoMode} showUxDemo={isUxDemoMode} />;
}

function Landing() {
  const [, navigate] = useLocation();
  return <div className="marketing-page">
    <Header />
    <main>
      <section className="landing-hero">
        <img src={heroRunner} alt="함께 달리는 두 사람" />
        <div className="hero-shade" />
        <div className="landing-hero-copy">
          <p className="eyebrow light">SWEATING</p>
          <h1>움직여야,<br /><em>좋은 사람을 만난다.</em></h1>
          <p className="hero-subcopy">취미가 맞으니, 만남이 즐겁다.</p>
          <button className="button button-accent" onClick={() => navigate("/signup")}>내 첫 클래스 찾기 <ArrowUpRight size={16} /></button>
        </div>
        <span className="hero-index">SWEATING V0 / 01</span>
      </section>
      <section className="landing-intro brand-story wrap" id="story">
        <div><p className="eyebrow">ABOUT SWEATING</p><h2>좋은 관계는<br /><span>좋은 경험</span>에서 시작됩니다.</h2></div>
        <div className="body-copy brand-story-copy">
          <p>SWEATING은 운동을 통해 새로운 인연을 발견하는 소셜 웰니스 플랫폼입니다.</p>
          <p>서로의 조건을 먼저 비교하기보다 함께 달리고, 땀 흘리고, 같은 시간을 보내며 자연스럽게 알아갑니다.</p>
          <p>운동 전에는 서로의 프로필을 볼 수 없습니다.</p>
          <p>운동이 끝난 후, 함께했던 사람들을 알아보고 서로 마음이 통한다면 새로운 만남을 시작할 수 있습니다.</p>
        </div>
      </section>
      <section className="preview-section" id="classes">
        <div className="wrap"><div className="section-heading"><div><p className="eyebrow">THIS WEEK / 002</p><h2>이번 주에<br />움직이는 사람들.</h2></div><span className="heading-note">작은 그룹<br />좋은 페이스<br />앱은 잠깐</span></div>
          <div className="preview-list">{["선셋 러닝 클럽", "사우스포 소셜", "스트렝스 & 커피"].map((title, i) => <div className="preview-row" key={title}><span>0{i + 1}</span><strong>{title}</strong><small>{sports[i]} · 예시시</small><ArrowUpRight size={17} /></div>)}</div>
        </div>
      </section>
      <section className="landing-cta"><div className="wrap"><p className="eyebrow light">MOVE TO MEET.</p><h2>있는 그대로<br /><em>오세요.</em></h2><button className="button button-light" onClick={() => navigate("/signup")}>무료로 시작하기 <ArrowUpRight size={16} /></button></div></section>
    </main>
    <SiteFooter />
  </div>;
}

// Same copy for a new address and one that is already registered.
const SIGNUP_CHECK_EMAIL = "메일을 확인해 주세요. 인증 메일이 도착하면, 인증을 마친 뒤 로그인해 주세요.";

function AuthScreen({ mode }: { mode: "login" | "signup" }) {
  const { setSession } = useAuth();
  const [, navigate] = useLocation();
  const rawAuthSearch = useRawSearch();
  const returnTo = mode === "login" ? parseClassReturn(rawAuthSearch) : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState<ConsentChoice>(EMPTY_CONSENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const oauthError = oauthErrorFromSearch(window.location.search);
    if (oauthError) setError(oauthError);
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "signup" && !consentReady(consent)) {
      setError("이용약관, 개인정보 수집·이용, 국외 이전에 모두 동의해 주세요.");
      return;
    }
    if (mode === "signup") {
      const check = validateNewPassword(password, { email });
      if (!check.ok) {
        setError(passwordPolicyMessage(check.reason));
        return;
      }
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const next = mode === "login" ? await logIn({ email, password }) : await signUp({
        email,
        password,
        terms: true,
        privacy: true,
        overseas_transfer: true,
      });
      if (mode === "signup" && !next.profile) {
        try {
          const current = await getCurrentUser();
          setSession(current);
          navigate("/profile");
        } catch {
          setNotice(SIGNUP_CHECK_EMAIL);
        }
      } else {
        setSession(next);
        navigate(next.profile ? returnTo ?? "/home" : returnTo ? classProfileUrl(returnTo) : "/profile");
      }
    } catch (err) {
      const message = errorMessage(err, mode === "login" ? "로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요." : "가입을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setError(mode === "signup" && message === "회원가입에 실패했습니다. 입력한 정보를 확인해 주세요."
        ? "가입을 완료하지 못했어요. 이메일 주소를 확인하거나 잠시 후 다시 시도해 주세요."
        : message);
    } finally { setBusy(false); }
  };
  return <div className="auth-page"><div className="auth-panel"><Brand /><div className="auth-heading"><p className="eyebrow">SWEATIN’ / JOIN</p><h1>{mode === "login" ? "다시 만나요." : <>움직일 준비가<br />됐나요?</>}</h1><p>{mode === "login" ? "오늘의 클래스를 이어서 찾아보세요." : "운동 하나만 고르면, 나머지는 천천히 시작돼요."}</p></div>
    {returnTo && <p className="privacy-note" data-testid="notice-class-return">로그인 후 보던 클래스 상세로 돌아갑니다. 참가 신청은 자동으로 진행되지 않습니다.</p>}
    <form className="stack-form" onSubmit={submit}><label>이메일<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></label><label>비밀번호<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "login" ? "비밀번호" : "10자 이상, 글자와 숫자"} minLength={mode === "login" ? undefined : 10} required /></label>{mode === "signup" && <ConsentFields value={consent} onChange={setConsent} />}{mode === "signup" && <p className="form-note">카카오·Google로 시작하면 로그인 뒤 같은 세 가지 동의를 한 번 저장합니다.</p>}{notice && <p className="form-note" role="status" data-testid="status-signup-check-email">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy || (mode === "signup" && !consentReady(consent))}>{busy ? "잠시만요…" : mode === "login" ? "로그인" : "계정 만들기"} <ArrowUpRight size={16} /></button></form>
    {mode === "login" && <p className="auth-switch auth-help"><button type="button" onClick={() => navigate("/forgot-password")} data-testid="link-forgot-password">비밀번호를 잊으셨나요?</button></p>}
    <div className="auth-divider"><span>또는</span></div>
    <div className="social-login">{socialLoginButtons.map(provider => <button className={`button ${provider.id}-button`} type="button" key={provider.id} onClick={() => window.location.assign(provider.startPath)} disabled={busy} data-testid={provider.testId}>{provider.id === "google" ? <SiGoogle className="google-mark" aria-hidden="true" /> : <span className="kakao-mark" aria-hidden="true">K</span>} {provider.label}</button>)}</div>
    <p className="auth-switch">{mode === "login" ? "처음이신가요?" : "이미 계정이 있나요?"} <button onClick={() => navigate(mode === "login" ? "/signup" : "/login")}>{mode === "login" ? "가입하기" : "로그인"}</button></p>
  </div></div>;
}

function ProfileScreen() {
  const { session, setSession } = useAuth();
  const [, navigate] = useLocation();
  const returnTo = parseClassReturn(useRawSearch());
  const current = session?.profile;
  const bounds = birthYearBounds();
  const locked = current?.birth_year != null;
  const [name, setName] = useState(current?.display_name ?? "");
  const [photo, setPhoto] = useState(current?.profile_photo_url ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(current?.profile_photo_url ?? "");
  const [birthYear, setBirthYear] = useState(current?.birth_year ? String(current.birth_year) : "");
  const [olderPreference, setOlderPreference] = useState(current?.age_preference === "both");
  const [selectedSports, setSelectedSports] = useState(current?.sports ?? []);
  const [selectedInterests, setSelectedInterests] = useState(current?.interests ?? []);
  const [bio, setBio] = useState(current?.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const parsedYear = Number(birthYear);
  const band = ageBandForBirthYear(Number.isInteger(parsedYear) ? parsedYear : null);
  const toggle = (value: string, list: string[], setList: (next: string[]) => void) => setList(list.includes(value) ? list.filter(item => item !== value) : [...list, value]);
  const choosePhoto = (next: File | null) => {
    setFile(next);
    if (!next) return;
    const problem = profilePhotoFileError(next);
    if (problem) { setError(problem); setFile(null); return; }
    setError("");
    setPreview(URL.createObjectURL(next));
  };
  useEffect(() => () => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSports.length) { setError("운동을 하나 이상 골라 주세요."); return; }
    if (!birthYear) { setError("출생 연도를 입력해 주세요."); return; }
    if (!band) { setError("현재 모집은 출생 연도 기준 20세부터 45세까지예요."); return; }
    if (!file && !photo.trim()) { setError("프로필 사진을 올려 주세요."); return; }
    setBusy(true); setError("");
    let photoValue = photo;
    try {
      if (file) {
        const uploaded = await uploadProfilePhoto(file);
        photoValue = uploaded.profile_photo_ref;
        setPhoto(uploaded.profile_photo_ref);
        if (uploaded.profile_photo_url) setPreview(uploaded.profile_photo_url);
      }
    } catch (err) {
      setError(errorMessage(err, "사진을 저장하지 못했습니다."));
      setBusy(false);
      return;
    }
    const input: ProfileInput = {
      display_name: name,
      birth_year: locked && current?.birth_year ? current.birth_year : parsedYear,
      profile_photo_url: photoValue,
      sports: selectedSports,
      interests: selectedInterests,
      bio: bio || null,
      age_preference: olderPreference ? "both" : "same_band",
    };
    try { const profile = await saveMyProfile(input); setSession({ ...session!, profile }); navigate(returnTo ?? "/home"); } catch (err) { setError(errorMessage(err, "프로필을 저장하지 못했습니다.")); } finally { setBusy(false); }
  };
  return <div className="app-page"><Header /><main className="form-page wrap"><div className="form-page-heading"><p className="eyebrow">PROFILE / 001</p><h1>{current ? "프로필을 다듬어요." : <>처음 만나는<br />방법을 골라요.</>}</h1><p>키와 몸무게는 묻지 않아요. 같이 움직일 때 필요한 것만 담습니다.</p></div><form className="profile-form" onSubmit={submit} data-testid="form-profile">
    <label>이름 <input value={name} onChange={e => setName(e.target.value)} placeholder="닉네임 또는 이름" required maxLength={40} /></label>
    <label>출생 연도 <input type="number" inputMode="numeric" min={bounds.min} max={bounds.max} value={birthYear} onChange={e => setBirthYear(e.target.value)} placeholder={`${bounds.min}–${bounds.max}`} required disabled={locked} data-testid="input-birth-year" /></label>
    <p className="age-note" data-testid="text-age-band">{locked ? "출생 연도는 한 번 저장하면 바꿀 수 없어요. 정정이 필요하면 운영자가 데이터베이스에서 풀어 주세요." : "신분증 확인은 하지 않아요. 서울 기준 올해에서 출생 연도를 뺀 나이로 구간을 정합니다."}{band ? ` 내 구간은 ${ageBandLabel(band)}.` : ""} 기본은 내 구간이고, 연상 선호를 켜면 바로 위 한 구간이 열립니다.</p>
    <label><input type="checkbox" role="switch" checked={olderPreference} onChange={(event) => setOlderPreference(event.target.checked)} data-testid="switch-older-preference" /> 연상 선호</label>
    <p className="age-note">켜면 바로 위 연령 구간 수업에도 참가할 수 있어요. 두 구간 위는 열리지 않고, 아래 구간은 그 수업 최고 나이보다 3살까지만 열려요.</p>
    <label className="profile-photo-field">프로필 사진 <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => choosePhoto(e.target.files?.[0] ?? null)} disabled={busy} data-testid="input-profile-photo" /></label>
    {(preview.startsWith("blob:") || preview.startsWith("http://") || preview.startsWith("https://")) && <img className="profile-photo-preview" src={preview} alt="프로필 미리보기" />}
    <p className="age-note">JPEG, PNG, WEBP, 5MB 이하. 사진에 포함된 위치 정보는 저장 전에 지웁니다. 이미 주소로 저장된 사진은 그대로 보여요.</p>
    <fieldset><legend>요즘 하고 싶은 운동 <small>하나 이상</small></legend><div className="chip-list">{sports.map(item => <button type="button" className={`chip ${selectedSports.includes(item) ? "selected" : ""}`} onClick={() => toggle(item, selectedSports, setSelectedSports)} key={item}>{selectedSports.includes(item) && <Check size={14} />}{item}</button>)}</div></fieldset>
    <fieldset><legend>운동 후 좋아하는 것</legend><div className="chip-list">{interests.map(item => <button type="button" className={`chip ${selectedInterests.includes(item) ? "selected" : ""}`} onClick={() => toggle(item, selectedInterests, setSelectedInterests)} key={item}>{selectedInterests.includes(item) && <Check size={14} />}{item}</button>)}</div></fieldset>
    <label>한 줄 소개 <textarea value={bio} onChange={e => setBio(e.target.value)} placeholder="예: 천천히 달리고, 맛있는 커피를 좋아해요." maxLength={160} /></label>
    {error && <p className="form-error">{error}</p>}<button className="button button-primary" disabled={busy} data-testid="button-save-profile">{busy ? "저장 중…" : "프로필 저장하고 클래스 보기"} <ArrowUpRight size={16} /></button>
  </form>
  <DeleteAccountPanel onDeleted={() => { setSession(null); window.location.href = "/"; }} />
  </main></div>;
}

function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-page"><Header /><main>{children}</main><SiteFooter /></div>;
}

function ConsentGate() {
  const { session, setSession, signOut } = useAuth();
  const [choice, setChoice] = useState<ConsentChoice>(EMPTY_CONSENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || !consentReady(choice)) return;
    setBusy(true);
    setError("");
    try {
      const status = await acceptAccountConsents(choice);
      setSession({ ...session, consents_current: status.consents_current });
    } catch (err) {
      setError(errorMessage(err, "동의를 저장하지 못했습니다."));
      setBusy(false);
    }
  };
  return <div className="app-page"><Header /><main className="form-page wrap"><div className="form-page-heading"><p className="eyebrow">CONSENT</p><h1>시작하기 전에<br /><em>동의가 필요해요.</em></h1><p>이미 가입한 계정도 현재 버전의 약관, 개인정보 수집·이용, 국외 이전에 한 번씩 동의합니다.</p></div><form className="stack-form" onSubmit={submit} data-testid="form-consent-gate"><ConsentFields value={choice} onChange={setChoice} />{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy || !consentReady(choice)} data-testid="button-consent-continue">{busy ? "저장 중…" : "동의하고 계속"}</button><button type="button" className="text-link" onClick={() => void signOut()}>로그아웃</button></form></main><SiteFooter /></div>;
}

function BlindScreen({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [room, setRoom] = useState<Awaited<ReturnType<typeof getBlindWorkout>> | null>(null);
  const [revealed, setRevealed] = useState<RevealedParticipantsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [likeBusy, setLikeBusy] = useState("");
  const [likeNotice, setLikeNotice] = useState("");
  const [newMatch, setNewMatch] = useState(false);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getBlindWorkout(id);
      setRoom(next);
      if (next.is_revealed) setRevealed(await getRevealedParticipants(id));
      else setRevealed(null);
    } catch (err) {
      setError(errorMessage(err, "Blind Workout을 열 수 없습니다."));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [id]);
  const like = async (participantId: string) => {
    setLikeBusy(participantId);
    setLikeNotice("");
    setNewMatch(false);
    try {
      const result = await likeParticipant(id, { participant_id: participantId });
      setRevealed(current => current ? {
        ...current,
        participants: current.participants.map(person =>
          person.participant_id === participantId
            ? { ...person, is_liked: true, is_matched: result.matched }
            : person),
      } : current);
      setNewMatch(result.matched);
       setLikeNotice(result.matched ? "서로 관심을 보냈어요. 매치 목록에서 확인해 보세요." : "관심을 보냈어요. 상대도 마음이 같으면 매치됩니다.");
      try {
        setRevealed(await getRevealedParticipants(id));
      } catch {
        setLikeNotice("관심은 전달됐어요. 최신 정보는 화면을 다시 열어 확인해 주세요.");
      }
    } catch (err) {
      setLikeNotice(errorMessage(err, "관심을 보내지 못했습니다."));
    } finally {
      setLikeBusy("");
    }
  };
  const isRevealed = Boolean(room?.is_revealed || revealed?.is_revealed);
  const people = revealed?.participants ?? room?.participants ?? [];
   return <AppShell><section className="blind-page wrap"><button className="back-link" onClick={() => navigate(`/classes/${id}`)}><ArrowLeft size={15} /> 클래스 상세</button>{loading ? <div className="loading-state"><div className="skeleton-list"><div className="skeleton-line" /><div className="skeleton-line" /></div></div> : error ? <div className="loading-state"><p className="form-error">{error}</p><button className="text-link" onClick={() => void load()}>다시 불러오기</button></div> : room ? isRevealed ? <><div className="blind-reveal-hero"><p className="eyebrow light">WORKOUT COMPLETE / {room.class.sport_type}</p><h1>오늘 함께 운동한<br /><em>사람들이에요.</em></h1><p>{revealed?.message || "이제 수업에서 만난 사람들의 공개 프로필을 볼 수 있어요. 마음이 가는 사람에게만 관심을 표현해 보세요."}</p></div><div className="reveal-context"><span><CalendarDays size={15} />{formatDate(room.class.scheduled_at)}</span><span><MapPin size={15} />{room.class.gym.name}</span><span><Users size={15} />{people.length}명 참여</span></div>{likeNotice && <div className="match-notice" role="status">{likeNotice}{newMatch && <button type="button" className="text-link" onClick={() => navigate("/matches")}>매치 목록 보기 <ArrowUpRight size={14} /></button>}</div>}{people.length ? <div className="participant-grid">{people.map(person => <ParticipantCard key={person.participant_id} participant={person} busy={likeBusy === person.participant_id} onLike={() => void like(person.participant_id)} />)}</div> : <div className="empty-state"><Users size={20} /><p>함께 운동한 사람이 아직 없어요.</p></div>}</> : <><div className="blind-hero"><p className="eyebrow light">BLIND WORKOUT / {room.class.sport_type}</p><h1>이름은 잠시<br /><em>뒤에 만나요.</em></h1><p>{room.message || "먼저 같은 공간에서 움직여요. 참가자 프로필은 수업이 시작되기 전까지 블라인드 처리됩니다."}</p></div><div className="blind-room-card"><div className="blind-room-header"><span><Users size={18} /> 현재 참가자</span><strong>{room.participant_count} / {room.class.capacity}</strong></div><div className="blind-slots">{room.participant_slots.map((slot, i) => <div className="blind-slot" key={i}><span>{i + 1}</span><div className="slot-line" /><small>{slot}</small></div>)}</div><div className="blind-next"><span><CalendarDays size={16} />{formatDate(room.class.scheduled_at)}</span><span><MapPin size={16} />{room.class.gym.name}</span></div><button className="button button-primary" onClick={() => navigate("/activity")}>내 활동에서 확인하기 <ArrowUpRight size={16} /></button></div></> : null}</section></AppShell>;
}

function ParticipantCard({ participant, busy, onLike }: { participant: PublicParticipantProfile; busy: boolean; onLike: () => void }) {
  const photo = participant.profile_photo_url?.trim();
  return <article className="participant-card" data-testid={`card-participant-${participant.participant_id}`}><div>{photo ? <img className="participant-photo" src={photo} alt={`${participant.display_name} 프로필`} /> : <div className="participant-photo participant-photo-fallback" aria-label={`${participant.display_name} 프로필`}>{participant.display_name.slice(0, 1)}</div>}</div><div className="participant-card-body"><div className="participant-card-top"><h3>{participant.display_name}</h3>{participant.is_matched ? <span className="match-mark"><Heart size={13} fill="currentColor" /> 매치</span> : <button className={`like-button ${participant.is_liked ? "liked" : ""}`} onClick={onLike} disabled={busy || participant.is_liked} data-testid={`button-like-${participant.participant_id}`}><Heart size={13} fill={participant.is_liked ? "currentColor" : "none"} />{busy ? "보내는 중…" : participant.is_liked ? "관심 표현 완료" : "관심 표현"}</button>}</div>{participant.bio && <p className="participant-bio">{participant.bio}</p>}<div className="participant-tags">{[...participant.sports, ...participant.interests].slice(0, 5).map(tag => <span className="participant-tag" key={`${participant.participant_id}-${tag}`}>{tag}</span>)}</div></div></article>;
}

function ActivityScreen() {
  const [, navigate] = useLocation();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try { setActivity(await getMyActivity()); } catch (err) { setError(errorMessage(err, "활동을 불러오지 못했습니다.")); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <AppShell><section className="activity-page wrap"><div className="page-heading"><p className="eyebrow">MY ACTIVITY / 003</p><h1>내가 고른<br /><em>움직임.</em></h1><p>참가한 클래스와 다음 약속을 한 곳에서 확인해요.</p></div>{loading ? <div className="loading-state"><div className="skeleton-list"><div className="skeleton-line" /><div className="skeleton-line" /></div></div> : error ? <div className="loading-state"><p className="form-error">{error}</p><button className="text-link" onClick={() => void load()}>다시 불러오기</button></div> : activity && <><ActivityGroup title="다가오는 클래스" items={activity.upcoming} status="운동 예정" actionLabel="Blind Workout 보기" onClick={id => navigate(`/blind/${id}`)} empty="아직 예정된 클래스가 없어요." /><ActivityGroup title="지난 클래스" items={activity.completed} status="운동 완료" actionLabel="오늘 함께 운동한 사람들 보기" onClick={id => navigate(`/blind/${id}`)} empty="첫 운동을 시작해 보세요." /></>}</section></AppShell>;
}

function ActivityGroup({ title, items, status, actionLabel, onClick, empty }: { title: string; items: ClassDetail[]; status: string; actionLabel: string; onClick: (id: string) => void; empty: string }) {
  return <section className="activity-group"><div className="group-heading"><h2>{title}</h2><span>{items.length}</span></div>{items.length ? items.map(item => <button className="activity-row" onClick={() => onClick(item.id)} key={item.id} data-testid={`row-activity-${item.id}`}><span className="activity-icon"><Dumbbell size={16} /></span><span className="activity-row-content"><strong>{item.title}</strong><small>{formatDate(item.scheduled_at)} · {item.gym.name}</small><span className="activity-statuses"><span className="status-pill done"><Check size={11} /> 신청 완료</span><span className={`status-pill ${status === "운동 완료" ? "complete" : ""}`}>{status}</span></span><span className="activity-row-action">{actionLabel} <ArrowUpRight size={13} /></span></span><ChevronRight size={17} /></button>) : <div className="activity-empty">{empty}</div>}</section>;
}

function MatchCard({ match }: { match: MatchSummary }) {
  const participant = match.participant;
  const photo = participant.profile_photo_url?.trim();
  return <article className="match-card" data-testid={`card-match-${match.id}`}>{photo ? <img className="participant-photo" src={photo} alt={`${participant.display_name} 프로필`} /> : <div className="participant-photo participant-photo-fallback" aria-label={`${participant.display_name} 프로필`}>{participant.display_name.slice(0, 1)}</div>}<div className="match-card-body"><div className="match-card-heading"><h3>{participant.display_name}</h3><span className="match-mark"><Heart size={13} fill="currentColor" /> 매치</span></div>{participant.bio && <p className="participant-bio">{participant.bio}</p>}<p className="match-class">{match.class_title}</p><div className="match-meta"><span>{match.sport_type}</span><span><CalendarDays size={13} />{formatDate(match.scheduled_at)}</span><span><MapPin size={13} />{match.gym_name}</span></div><div className="match-card-actions"><Link href={`/matches/${encodeURIComponent(match.id)}/chat`} className="text-link" data-testid={`link-match-chat-${match.id}`}>대화하기 <ArrowUpRight size={14} /></Link></div></div></article>;
}

function MatchesScreen() {
  const [, navigate] = useLocation();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try { setMatches(await listMatches()); } catch (err) { setError(errorMessage(err, "매치를 불러오지 못했습니다.")); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <AppShell><section className="matches-page wrap activity-page"><div className="page-heading"><p className="eyebrow">MATCHES / 004</p><h1>운동으로<br /><em>이어진 사이.</em></h1><p>같은 클래스에서 서로 관심을 표현한 매치만 모아봤어요.</p></div>{loading ? <div className="loading-state"><div className="skeleton-list"><div className="skeleton-line" /><div className="skeleton-line" /></div></div> : error ? <div className="loading-state"><p className="form-error">{error}</p><button className="text-link" onClick={() => void load()}>다시 불러오기</button></div> : matches.length ? <div className="matches-list">{matches.map(match => <MatchCard match={match} key={match.id} />)}</div> : <div className="empty-state"><Heart size={20} /><p>아직 매치가 없어요.<br />다음 클래스에서 천천히 알아가 보세요.</p><button type="button" className="text-link" onClick={() => navigate("/home")}>클래스 둘러보기 <ArrowUpRight size={14} /></button></div>}</section></AppShell>;
}

type AdminParticipant = {
  id: string;
  user_id: string;
  attendance_status: string;
  profiles?: { display_name?: string | null } | null;
};

const ATTENDANCE_LABEL: Record<string, string> = {
  registered: "신청",
  attended: "출석",
  no_show: "불참",
  cancelled: "취소",
};

function AttendancePanel({ classId, onError }: { classId: string; onError: (message: string) => void }) {
  const [participants, setParticipants] = useState<AdminParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const result = await fetch(`/api/admin/classes/${classId}/participants`, { credentials: "include" });
        if (!result.ok) throw new Error("참가자 목록을 불러오지 못했습니다.");
        const rows = await result.json() as AdminParticipant[];
        if (!cancelled) setParticipants(rows);
      } catch (err) {
        if (!cancelled) onError(errorMessage(err, "참가자 목록을 불러오지 못했습니다."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [classId, version]);
  const record = async (userId: string, attendanceStatus: "attended" | "no_show") => {
    setBusyUserId(userId);
    onError("");
    try {
      const result = await fetch(`/api/admin/classes/${classId}/participants/${userId}/attendance`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendance_status: attendanceStatus }),
      });
      const payload = await result.json().catch(() => ({})) as { error?: string };
      if (!result.ok) throw new Error(payload.error || "출석을 기록하지 못했습니다.");
      setVersion((current) => current + 1);
    } catch (err) {
      onError(errorMessage(err, "출석을 기록하지 못했습니다."));
    } finally {
      setBusyUserId("");
    }
  };
  return <div className="attendance-panel" data-testid={`attendance-panel-${classId}`}>
    <p className="attendance-note">출석·불참은 수업 시작부터 종료 후 24시간까지 기록됩니다. 참가자는 본인 출석을 바꿀 수 없습니다.</p>
    {loading ? <div className="skeleton-line" /> : participants.length === 0 ? <p className="attendance-note">참가자가 없습니다.</p> : participants.map((person) => {
      const busy = busyUserId === person.user_id;
      const locked = person.attendance_status === "cancelled";
      return <div className="attendance-person" key={person.id} data-testid={`attendance-row-${person.user_id}`}>
        <span><strong>{person.profiles?.display_name || "참가자"}</strong> · {ATTENDANCE_LABEL[person.attendance_status] ?? person.attendance_status}</span>
        <span className="attendance-actions">
          <button type="button" aria-pressed={person.attendance_status === "attended"} disabled={busy || locked} onClick={() => void record(person.user_id, "attended")} data-testid={`button-attended-${person.user_id}`}>출석</button>
          <button type="button" aria-pressed={person.attendance_status === "no_show"} disabled={busy || locked} onClick={() => void record(person.user_id, "no_show")} data-testid={`button-no-show-${person.user_id}`}>불참</button>
        </span>
      </div>;
    })}
  </div>;
}

function AdminScreen() {
  const [classes, setClasses] = useState<ClassDetail[]>([]);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [title, setTitle] = useState("");
  const [sportType, setSportType] = useState(sports[0]);
  const [gymId, setGymId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState("60");
  const [capacity, setCapacity] = useState("8");
  const [price, setPrice] = useState("0");
  const [ageBand, setAgeBand] = useState<AgeBand>("20_25");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completionBusy, setCompletionBusy] = useState("");
  const [attendanceClassId, setAttendanceClassId] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      const [classResult, gymResult] = await Promise.all([
        fetch("/api/admin/classes", { credentials: "include" }),
        fetch("/api/admin/gyms", { credentials: "include" }),
      ]);
      if (!classResult.ok || !gymResult.ok) throw new Error("관리자 권한이 필요합니다.");
      const nextClasses = await classResult.json() as ClassDetail[];
      const nextGyms = await gymResult.json() as Gym[];
      setClasses(nextClasses);
      setGyms(nextGyms);
      if (!gymId && nextGyms[0]) setGymId(nextGyms[0].id);
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const createClass = async (event: FormEvent) => {
    event.preventDefault();
    if (!gymId || !title || !scheduledAt) { setError("체육관, 제목, 일정을 입력해 주세요."); return; }
    setSaving(true); setError("");
    try {
      const result = await fetch("/api/admin/classes", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gym_id: gymId, title, sport_type: sportType, scheduled_at: new Date(scheduledAt).toISOString(), duration_minutes: Number(duration), capacity: Number(capacity), price: Number(price), status: "published", age_band: ageBand }),
      });
      if (!result.ok) throw new Error("클래스를 만들지 못했습니다.");
      setTitle(""); setScheduledAt(""); await load();
    } catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  };
  const setBand = async (item: ClassDetail, nextBand: AgeBand) => {
    if (item.status !== "draft" && item.status !== "published" && item.status !== "cancelled") return;
    setError("");
    try {
      const result = await fetch(`/api/admin/classes/${item.id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gym_id: item.gym_id, title: item.title, sport_type: item.sport_type, description: item.description, scheduled_at: item.scheduled_at, duration_minutes: item.duration_minutes, capacity: item.capacity, price: item.price, image_url: item.image_url, status: item.status, age_band: nextBand }),
      });
      if (!result.ok) throw new Error("연령 구간을 저장하지 못했습니다.");
      await load();
    } catch (err) { setError(errorMessage(err, "연령 구간을 저장하지 못했습니다.")); }
  };
  const updateStatus = async (item: ClassDetail, status: string) => {
    setError("");
    try {
      const result = await fetch(`/api/admin/classes/${item.id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!result.ok) throw new Error("상태를 저장하지 못했습니다.");
      await load();
    } catch (err) { setError(errorMessage(err)); }
  };
  const complete = async (item: ClassDetail) => {
    setCompletionBusy(item.id);
    setError("");
    try { await completeClass(item.id); await load(); } catch (err) { setError(errorMessage(err, "클래스를 완료 처리하지 못했습니다.")); } finally { setCompletionBusy(""); }
  };
  return <AppShell><section className="admin-page wrap"><div className="page-heading"><p className="eyebrow">ADMIN / 005</p><h1>클래스<br /><em>운영 보드.</em></h1><p>수업 시작부터 종료 후 24시간 안에 출석을 기록하고, 종료 시각 이후 완료 처리하면 출석한 참가자에게만 프로필이 열립니다.</p></div>{error && <p className="form-error">{error}</p>}<GymDesk gyms={gyms} onChanged={() => void load()} /><OwnerNotices /><form className="admin-create" onSubmit={createClass}><div className="admin-create-head"><h2>새 클래스 만들기</h2><span>공개 상태로 바로 추가</span></div><label>클래스 이름<input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 토요일 선셋 러닝" /></label><div className="admin-form-grid"><label>운동<select value={sportType} onChange={e => setSportType(e.target.value)}>{sports.map(item => <option key={item}>{item}</option>)}</select></label><label>체육관<select value={gymId} onChange={e => setGymId(e.target.value)}>{gyms.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>일정<input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} /></label><label>시간(분)<input type="number" min="1" value={duration} onChange={e => setDuration(e.target.value)} data-testid="input-admin-duration" /></label><label>정원<input type="number" min="1" value={capacity} onChange={e => setCapacity(e.target.value)} /></label><label>가격<input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} /></label><label>연령 구간<select value={ageBand} onChange={e => { if (isAgeBand(e.target.value)) setAgeBand(e.target.value); }} data-testid="select-class-age-band">{AGE_BANDS.map(band => <option key={band} value={band}>{ageBandLabel(band)}</option>)}</select></label></div><button className="button button-primary" disabled={saving}>{saving ? "추가 중…" : "클래스 추가"} <ArrowUpRight size={16} /></button></form>{loading ? <div className="admin-list"><div className="skeleton-list"><div className="skeleton-line" /><div className="skeleton-line" /></div></div> : <div className="admin-list">{classes.length ? classes.map(item => <div className="admin-class" key={item.id}><div className="admin-row"><div><span className={`status-dot ${item.status}`} /> <strong>{item.title}</strong><small>{item.sport_type} · {ageBandLabel(item.age_band)} · {formatDate(item.scheduled_at)} · {item.gym.name}</small></div><div className="admin-row-actions"><span>{item.participant_count}/{item.capacity}명</span><button type="button" className="attendance-toggle" onClick={() => setAttendanceClassId(attendanceClassId === item.id ? "" : item.id)} data-testid={`button-attendance-${item.id}`}>{attendanceClassId === item.id ? "출석 닫기" : "출석 기록"}</button>{item.status === "completed" ? <span className="status-pill done">완료됨</span> : <><button className="complete-action" onClick={() => void complete(item)} disabled={completionBusy === item.id} data-testid={`button-complete-${item.id}`}>{completionBusy === item.id ? "처리 중…" : "완료 처리"}</button><select value={isAgeBand(item.age_band) ? item.age_band : ""} onChange={e => { if (isAgeBand(e.target.value)) void setBand(item, e.target.value); }} aria-label={`${item.title} 연령 구간`} data-testid={`select-age-band-${item.id}`}><option value="" disabled>구간 선택</option>{AGE_BANDS.map(band => <option key={band} value={band}>{ageBandLabel(band)}</option>)}</select><select value={item.status} onChange={e => void updateStatus(item, e.target.value)} aria-label={`${item.title} 상태`}><option value="published">공개</option><option value="draft">초안</option><option value="cancelled">취소</option></select></>}</div></div>{attendanceClassId === item.id && <AttendancePanel classId={item.id} onError={setError} />}</div>) : <div className="admin-empty">관리할 클래스가 아직 없어요.</div>}</div>}</section></AppShell>;
}

function OwnerGate({ session }: { session: NonNullable<ReturnType<typeof useAuth>["session"]> }) {
  const [gyms, setGyms] = useState<Gym[] | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/owner/gyms", { credentials: "include" })
      .then(async (result) => {
        if (!result.ok) {
          if (!cancelled) setDenied(true);
          return;
        }
        const rows = await result.json() as Gym[];
        if (!cancelled) setGyms(rows);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (denied) return <ExploreHome Shell={AppShell} session={session} />;
  if (!gyms) return <div className="loading-screen">SWEATING</div>;
  return <OwnerScreen Shell={AppShell} initialGyms={gyms} />;
}

function ResetPasswordRoute() {
  const { setSession } = useAuth();
  return <ResetPasswordScreen onSignedIn={setSession} />;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function RouterView() {
  const { session, loading } = useAuth();
  const [location] = useLocation();
  if (loading) return <div className="loading-screen">SWEATING</div>;
  if (session && needsConsentGate(session.consents_current, location)) return <ConsentGate />;
  return <RoutedErrorBoundary><RecoveryLinkRedirect />{session ? <PrinciplesGate /> : null}<Switch>
    <Route path="/privacy">{() => <PrivacyPage header={<Header />} />}</Route>
    <Route path="/terms">{() => <TermsPage header={<Header />} />}</Route>
    <Route path="/about">{() => <AboutPage Shell={AppShell} />}</Route>
    <Route path="/partners">{() => <PartnersPage Shell={AppShell} />}</Route>
    <Route path="/start">{() => <StartPage Shell={AppShell} />}</Route>
    <Route path="/login">{() => session ? <RedirectHome /> : <AuthScreen mode="login" />}</Route>
    <Route path="/signup">{() => session ? <RedirectHome /> : <AuthScreen mode="signup" />}</Route>
    <Route path="/forgot-password">{() => <ForgotPasswordScreen />}</Route>
    <Route path="/reset-password">{() => <ResetPasswordRoute />}</Route>
    <Route path="/profile">{() => session ? <ProfileScreen /> : <RedirectLogin />}</Route>
    <Route path="/">{() => <ExploreHome Shell={AppShell} session={session} />}</Route>
    <Route path="/home">{() => <ExploreHome Shell={AppShell} session={session} />}</Route>
    <Route path="/preview/capacity">{() => isClassDemoMode ? <AppShell><SampleCapacitySettings /></AppShell> : <ExploreHome Shell={AppShell} session={session} />}</Route>
    <Route path="/preview/:page">{params => <DemoSurface page={params.page} Shell={AppShell} Fallback={Landing} />}</Route>
    <Route path="/classes/:id">{params => <ClassDetailPage id={params.id} Shell={AppShell} session={session} />}</Route>
    <Route path="/blind/:id">{params => session?.profile ? (isClassDemoMode ? <AppShell><PreviewUnavailable feature="Blind Workout" /></AppShell> : <BlindScreen id={params.id} />) : <RedirectLogin />}</Route>
    <Route path="/activity">{() => session?.profile ? (isClassDemoMode ? <AppShell><PreviewUnavailable feature="내 활동" /></AppShell> : <ActivityScreen />) : <RedirectLogin />}</Route>
    <Route path="/matches/:id/chat">{params => session?.profile ? (isClassDemoMode ? <AppShell><PreviewUnavailable feature="매치 대화" /></AppShell> : <AppShell><MatchChatPage matchId={params.id} /></AppShell>) : <RedirectLogin />}</Route>
    <Route path="/matches">{() => session?.profile ? (isClassDemoMode ? <AppShell><PreviewUnavailable feature="매치" /></AppShell> : <MatchesScreen />) : <RedirectLogin />}</Route>
    <Route path="/messages">{() => session ? <AppShell><MessagesPage /></AppShell> : <RedirectLogin />}</Route>
    <Route path="/owner">{() => session ? (isClassDemoMode ? <ExploreHome Shell={AppShell} session={session} /> : <OwnerGate session={session} />) : <RedirectLogin />}</Route>
    <Route path="/admin">{() => session?.profile?.is_admin ? (isClassDemoMode ? <AppShell><SampleCapacitySettings embedded /></AppShell> : <AdminScreen />) : session ? <ExploreHome Shell={AppShell} session={session} /> : <RedirectLogin />}</Route>
    <Route component={Landing} />
  </Switch></RoutedErrorBoundary>;
}

function RedirectHome() { const [, navigate] = useLocation(); useEffect(() => navigate("/home"), [navigate]); return <div className="loading-screen">이동 중…</div>; }
function RedirectLogin() { const [, navigate] = useLocation(); useEffect(() => navigate("/login"), [navigate]); return <div className="loading-screen">로그인이 필요해요.</div>; }

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}><AuthProvider>{isUxDemoMode || isClassDemoMode ? <DemoMoneyProvider><RouterView /></DemoMoneyProvider> : <RouterView />}</AuthProvider></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;