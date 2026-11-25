import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useSearch as useRawSearch } from "wouter/use-browser-location";
import { requestPasswordReset, resetPassword, type AuthSession } from "@workspace/api-client-react";
import { withCampaign } from "@/visual-v2/campaign";
import {
  clearRecoveryLink,
  discardSignupLink,
  parseRecoveryLink,
  readRecoveryArrival,
  recoveryUrlWithoutSecrets,
  rememberRecoveryLink,
  type RecoveryLink,
} from "./recovery-link";
import { isUserFacingMessage, userFacingMessage } from "./user-message";
import { passwordPolicyMessage, validateNewPassword } from "@workspace/password-policy";

const SENT_FALLBACK = "메일을 확인해 주세요. 가입된 주소라면 재설정 링크가 도착해요.";
const SEND_FAILED = "재설정 메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.";
const LINK_INVALID = "재설정 링크가 만료됐거나 올바르지 않아요. 로그인 화면에서 다시 요청해 주세요.";
const MISMATCH = "비밀번호가 서로 달라요. 다시 입력해 주세요.";
const SAVE_FAILED = "비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.";
const LOGIN_FOLLOWUP = "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.";

function Brand() {
  const search = useRawSearch();
  return <Link href={withCampaign("/", search)} className="brand">SWEATING</Link>;
}

export function RecoveryLinkRedirect() {
  const [location, navigate] = useLocation();
  useEffect(() => {
    const capture = () => {
      const parsed = parseRecoveryLink(window.location.hash, window.location.search);
      if (parsed.kind === "absent") {
        // Signup confirmation links are never used to sign in. Only strip them.
        discardSignupLink();
        return;
      }
      rememberRecoveryLink(parsed);
      const next = recoveryUrlWithoutSecrets(window.location.href);
      if (next !== window.location.href) {
        window.history.replaceState(window.history.state, "", next);
      }
      if (location !== "/reset-password") navigate("/reset-password");
    };
    capture();
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, [location, navigate]);
  return null;
}

export function ForgotPasswordScreen() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await requestPasswordReset({ email });
      setSent(isUserFacingMessage(result.message) ? result.message : SENT_FALLBACK);
    } catch (err) {
      setError(userFacingMessage(err, SEND_FAILED));
    } finally {
      setBusy(false);
    }
  };

  return <div className="auth-page"><div className="auth-panel"><Brand /><div className="auth-heading"><p className="eyebrow">SWEATIN’ / JOIN</p><h1>비밀번호를<br />다시 정해요.</h1><p>가입할 때 쓴 이메일로 재설정 링크를 보내 드려요.</p></div>
    {sent ? <div className="stack-form"><p className="form-note" role="status" data-testid="status-reset-sent">{sent}</p><p className="form-note">몇 분이 지나도 보이지 않으면 스팸함도 봐 주세요.</p><button className="button button-primary" type="button" onClick={() => navigate("/login")}>로그인으로 돌아가기 <ArrowUpRight size={16} /></button></div> : <form className="stack-form" onSubmit={submit} data-testid="form-forgot-password"><label>이메일<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required data-testid="input-reset-email" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy} data-testid="button-send-reset">{busy ? "잠시만요…" : "재설정 메일 보내기"} <ArrowUpRight size={16} /></button></form>}
    {!sent && <p className="auth-switch">기억나셨나요? <button type="button" onClick={() => navigate("/login")}>로그인</button></p>}
  </div></div>;
}

function InvalidReset({ message }: { message: string }) {
  const [, navigate] = useLocation();
  return <>
    <p className="form-error" role="alert" data-testid="status-reset-invalid">{message}</p>
    <button className="button button-primary" type="button" onClick={() => navigate("/forgot-password")}>재설정 메일 다시 받기 <ArrowUpRight size={16} /></button>
  </>;
}

export function ResetPasswordScreen({ onSignedIn }: { onSignedIn: (session: AuthSession) => void }) {
  const [, navigate] = useLocation();
  const [link, setLink] = useState<RecoveryLink>(() => readRecoveryArrival());
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(link.kind === "invalid" ? LINK_INVALID : "");
  const [done, setDone] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  // An email opened while this page is already showing may change only the hash.
  useEffect(() => {
    const apply = () => {
      const next = readRecoveryArrival();
      if (next.kind === "absent") return;
      setLink(next);
      setError(next.kind === "invalid" ? LINK_INVALID : "");
      setDone("");
      setSignedIn(false);
    };
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (link.kind !== "ready") return;
    if (password !== confirm) {
      setError(MISMATCH);
      return;
    }
    const check = validateNewPassword(password);
    if (!check.ok) {
      setError(passwordPolicyMessage(check.reason));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await resetPassword({ access_token: link.accessToken, password });
      clearRecoveryLink();
      if (result.session) {
        onSignedIn(result.session);
        setSignedIn(true);
      }
      setDone(isUserFacingMessage(result.message) ? result.message : result.session ? "비밀번호를 바꿨어요." : LOGIN_FOLLOWUP);
    } catch (err) {
      setError(userFacingMessage(err, SAVE_FAILED));
    } finally {
      setBusy(false);
    }
  };

  const heading = done ? <>비밀번호를<br />바꿨어요.</> : link.kind === "ready" ? <>새 비밀번호를<br />정해 주세요.</> : <>링크를<br />다시 받아 주세요.</>;
  const intro = done ? "이제 새 비밀번호로 들어올 수 있어요." : link.kind === "ready" ? "10자 이상, 글자와 숫자를 넣어 주세요." : "만료됐거나 올바르지 않은 링크예요.";
  return <div className="auth-page"><div className="auth-panel"><Brand /><div className="auth-heading"><p className="eyebrow">SWEATIN’ / JOIN</p><h1>{heading}</h1><p>{intro}</p></div>
    {done ? <div className="stack-form"><p className="form-note" role="status" data-testid="status-reset-done">{done}</p><button className="button button-primary" type="button" onClick={() => navigate(signedIn ? "/home" : "/login")}>{signedIn ? "클래스로 이동" : "로그인"} <ArrowUpRight size={16} /></button></div> : link.kind !== "ready" ? <div className="stack-form"><InvalidReset message={error || LINK_INVALID} /></div> : <form className="stack-form" onSubmit={submit} data-testid="form-new-password"><label>새 비밀번호<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="10자 이상, 글자와 숫자" minLength={10} required data-testid="input-new-password" /></label><label>비밀번호 확인<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="한 번 더 입력" minLength={10} required data-testid="input-confirm-password" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy} data-testid="button-save-password">{busy ? "잠시만요…" : "비밀번호 저장"} <ArrowUpRight size={16} /></button></form>}
    {!done && link.kind === "ready" && <p className="auth-switch"><button type="button" onClick={() => navigate("/login")}>로그인으로 돌아가기</button></p>}
  </div></div>;
}
