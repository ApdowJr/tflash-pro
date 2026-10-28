"use client";

import { ArrowLeftIcon, ArrowRightIcon, EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { browserSupabase } from "@/lib/supabase/browser";
import { verifySignupCode } from "@/lib/supabase/signup-code";
import { forgetSignup, readPendingSignup, rememberSignup, RESEND_DELAY_MS } from "@/lib/supabase/pending-signup";
import { authClient } from "@/lib/auth-client";
import { safeLocalPath } from "@/lib/security/redirect";
import { Brand, BrandMark } from "./brand";

type Language = "en" | "so";
type Mode = "signin" | "signup" | "verify" | "forgot";

const words = {
  en: {
    eyebrow: "A LITTLE MORE ROOM TO THINK",
    hero: "Make space for",
    heroEm: "better ideas.",
    heroBody: "Think, write and build with the AI models you choose. All in one considered space.",
    storyFoot: "A workspace for curious minds",
    signIn: "Sign in",
    vercelSignIn: "Continue with Vercel",
    orEmail: "or use email",
    vercelUnavailable: "Vercel sign-in is not configured on this deployment.",
    signUp: "Create account",
    welcome: "Welcome back.",
    welcomeBody: "Pick up where your ideas left off.",
    create: "Let’s get started.",
    createBody: "Create your account and make this space yours.",
    forgot: "Forgot password?",
    resetTitle: "Reset your password.",
    resetBody: "Enter your email and we’ll send you a reset link.",
    name: "Your name",
    namePlaceholder: "What should we call you?",
    email: "Email address",
    emailPlaceholder: "you@example.com",
    password: "Password",
    passwordPlaceholder: "Enter your password",
    newPassword: "New password",
    createPassword: "At least 8 characters",
    confirm: "Confirm password",
    confirmPlaceholder: "Enter your password again",
    continue: "Continue to Tflash",
    createButton: "Create your account",
    sendLink: "Send reset link",
    saving: "One moment…",
    back: "Back to sign in",
    verifyTitle: "Check your email.",
    verifyBody: "Enter the confirmation code we sent you. If an older email has a link, open it in this browser, then sign in.",
    verificationCode: "Confirmation code",
    codePlaceholder: "Enter the code from your email",
    verifyButton: "Verify email",
    haveCode: "Already have a confirmation code?",
    resendCode: "Resend code",
    resendIn: (seconds: number) => `Resend code in ${seconds}s`,
    codeResent: "If the account still needs confirmation, a new email is on its way.",
    verified: "Your email is confirmed. Sign in with your password to continue.",
    autoConfirmed: "Your account is ready. Sign in with your password to continue.",
    codeFormat: "Enter the numeric code from your email.",
    validEmail: "Enter a valid email address first.",
    codeInvalid: "That code is invalid or has expired. Check it or request a new one.",
    rateLimited: "Please wait a little before requesting another email.",
    signOutError: "Your account was created, but we couldn't finish signing out. Please try again.",
    checkReset: "If an account exists for that email, a reset link is on its way. Open it in this browser.",
    mismatch: "Passwords do not match.",
    shortPassword: "Use at least 8 characters for your password.",
    show: "Show password",
    hide: "Hide password",
    footer: "Your models. Your ideas. Your space.",
    linkError: "That link has expired or could not be verified. Please request a new one.",
    genericError: "Something went wrong. Please try again.",
    passwordTitle: "Choose a new password.",
    passwordBody: "Use a password you haven’t used before.",
    savePassword: "Update password",
    passwordDone: "Password updated. Taking you to your workspace…",
  },
  so: {
    eyebrow: "MEEL AAD KU FIKIRTO",
    hero: "Fikradahaaga sii",
    heroEm: "meel ay ku koraan.",
    heroBody: "Ku fikir, ku qor oo ku dhis model-ka AI ee aad doorato. Dhammaan hal goob oo deggan.",
    storyFoot: "Goob loogu talagalay dadka wax abuura",
    signIn: "Soo gal",
    vercelSignIn: "Ku sii wad Vercel",
    orEmail: "ama isticmaal email",
    vercelUnavailable: "Vercel sign-in looma diyaarin noocan.",
    signUp: "Samee akoon",
    welcome: "Soo dhawoow.",
    welcomeBody: "Halkii aad ka joogtay ka sii wad.",
    create: "Aan bilowno.",
    createBody: "Samee akoon si aad u hesho goob kuu gaar ah.",
    forgot: "Ma illowday furaha?",
    resetTitle: "Dib u deji furaha.",
    resetBody: "Geli email-kaaga, waxaana kuu soo diri doonaa xiriir aad ku beddesho furaha.",
    name: "Magacaaga",
    namePlaceholder: "Maxaan kuugu yeernaa?",
    email: "Cinwaanka email-ka",
    emailPlaceholder: "adiga@example.com",
    password: "Furaha sirta ah",
    passwordPlaceholder: "Geli furahaaga",
    newPassword: "Furaha cusub",
    createPassword: "Ugu yaraan 8 xaraf",
    confirm: "Xaqiiji furaha",
    confirmPlaceholder: "Mar kale geli furahaaga",
    continue: "Sii gal Tflash",
    createButton: "Samee akoonkaaga",
    sendLink: "Ii soo dir xiriirka",
    saving: "Sug hal daqiiqo…",
    back: "Ku noqo gelitaanka",
    verifyTitle: "Eeg email-kaaga.",
    verifyBody: "Geli koodhka xaqiijinta ee aan kuu dirnay. Haddii email hore xiriir leeyahay, ka fur browser-kan, kadibna soo gal.",
    verificationCode: "Koodhka xaqiijinta",
    codePlaceholder: "Geli koodhka email-kaaga ku jira",
    verifyButton: "Xaqiiji email-ka",
    haveCode: "Ma haysaa koodhka xaqiijinta?",
    resendCode: "Koodh cusub ii soo dir",
    resendIn: (seconds: number) => `Dib u dir ${seconds} ilbiriqsi kadib`,
    codeResent: "Haddii akoonku wali u baahan yahay xaqiijin, email cusub ayaa la dirayaa.",
    verified: "Email-kaaga waa la xaqiijiyay. Ku soo gal furahaaga si aad u sii wadato.",
    autoConfirmed: "Akoonkaagu waa diyaar. Ku soo gal furahaaga si aad u sii wadato.",
    codeFormat: "Geli koodhka tirooyinka ah ee email-kaaga ku jira.",
    validEmail: "Marka hore geli cinwaan email oo sax ah.",
    codeInvalid: "Koodhku waa khaldan yahay ama wuu dhacay. Hubi ama mid cusub codso.",
    rateLimited: "Fadlan wax yar sug ka hor intaadan email kale codsan.",
    signOutError: "Akoonka waa la sameeyay, balse bixitaanka lama dhammaystirin. Fadlan isku day mar kale.",
    checkReset: "Haddii akoon email-kan ku jiro, xiriirka dib-u-dejinta waa la dirayaa. Ka fur browser-kan.",
    mismatch: "Labada fure isma laha.",
    shortPassword: "Furahaagu ha ka koobnaado ugu yaraan 8 xaraf.",
    show: "Muuji furaha",
    hide: "Qari furaha",
    footer: "Modeladaada. Fikradahaaga. Goobtaada.",
    linkError: "Xiriirkaas wuu dhacay ama lama xaqiijin. Fadlan mid cusub codso.",
    genericError: "Wax baa qaldamay. Fadlan isku day mar kale.",
    passwordTitle: "Dooro fure cusub.",
    passwordBody: "Isticmaal fure aadan hore u isticmaalin.",
    savePassword: "Cusboonaysii furaha",
    passwordDone: "Furaha waa la beddelay. Waxa lagu geynayaa goobtaada…",
  },
} as const;

function useLanguage() {
  const [language, setLanguage] = useState<Language>("en");
  useEffect(() => {
    try {
      if (localStorage.getItem("tflash:language") === "so") setLanguage("so");
    } catch { /* Storage may be disabled. */ }
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const changeLanguage = (next: Language) => {
    setLanguage(next);
    try { localStorage.setItem("tflash:language", next); } catch { /* private browsing */ }
  };
  return { language, changeLanguage, text: words[language] };
}

function safeNext(): string {
  return safeLocalPath(new URLSearchParams(window.location.search).get("next"));
}

function AuthLayout({ children, language, onLanguageChange }: {
  readonly children: ReactNode;
  readonly language: Language;
  readonly onLanguageChange: (language: Language) => void;
}) {
  const text = words[language];
  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="About Tflash">
        <div className="auth-story-top"><Brand inverted /></div>
        <div aria-hidden="true" className="auth-art">
          <svg viewBox="0 0 500 410" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M68 210h364M250 28v356" stroke="#7b8a73" strokeOpacity=".24" strokeDasharray="3 8" />
            <circle cx="250" cy="210" r="152" stroke="#f2e8d5" strokeOpacity=".15" />
            <circle cx="250" cy="210" r="117" stroke="#f2e8d5" strokeOpacity=".13" />
            <ellipse cx="250" cy="210" rx="187" ry="62" transform="rotate(-28 250 210)" stroke="#eac983" strokeOpacity=".48" />
            <ellipse cx="250" cy="210" rx="187" ry="62" transform="rotate(28 250 210)" stroke="#eac983" strokeOpacity=".25" />
            <path d="M122 313 378 108" stroke="#eac983" strokeOpacity=".22" />
            <circle cx="115" cy="267" r="5" fill="#f3bd56" />
            <circle cx="390" cy="148" r="3.5" fill="#f2e8d5" />
            <circle cx="250" cy="210" r="4" fill="#f3bd56" />
            <path d="M82 56h39M82 56v39M418 364h-39M418 364v-39" stroke="#f2e8d5" strokeOpacity=".22" />
          </svg>
          <span className="auth-art-note">T / 01<br />A SPACE TO THINK</span>
        </div>
        <div className="auth-story-copy">
          <p className="auth-kicker"><span />{text.eyebrow}</p>
          <h1>{text.hero}<br /><em>{text.heroEm}</em></h1>
          <p className="auth-story-description">{text.heroBody}</p>
        </div>
        <div className="auth-story-footer"><span>{text.storyFoot}</span><span>© {new Date().getFullYear()} TFLASH</span></div>
      </section>
      <section className="auth-panel">
        <div className="auth-mobile-brand"><Brand /></div>
        <div className="auth-panel-top">
          <span className="auth-panel-index">YOUR WORKSPACE / 01</span>
          <div className="auth-language" aria-label="Language">
            <button aria-pressed={language === "en"} onClick={() => onLanguageChange("en")} type="button">EN</button>
            <span>/</span>
            <button aria-pressed={language === "so"} onClick={() => onLanguageChange("so")} type="button">SO</button>
          </div>
        </div>
        <div className="auth-panel-content">{children}</div>
        <div className="auth-panel-footer"><BrandMark className="size-5" /><span>{text.footer}</span></div>
      </section>
    </main>
  );
}

function PasswordInput({ id, value, onChange, placeholder, autoComplete, label, showLabel, hideLabel, minLength }: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly autoComplete: string;
  readonly label: string;
  readonly showLabel: string;
  readonly hideLabel: string;
  readonly minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input-wrap">
        <input autoComplete={autoComplete} id={id} minLength={minLength} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required type={show ? "text" : "password"} value={value} />
        <button aria-label={show ? hideLabel : showLabel} className="auth-show-password" onClick={() => setShow((value) => !value)} type="button">
          {show ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
        </button>
      </div>
    </div>
  );
}

type NoticeKey = "verified" | "autoConfirmed" | "codeResent" | "checkReset";

export function AuthScreen({ vercelAvailable }: { readonly vercelAvailable: boolean }) {
  const { language, changeLanguage, text } = useLanguage();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<NoticeKey | null>(null);
  const [error, setError] = useState("");
  const [badLink, setBadLink] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [clock, setClock] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setBadLink(params.get("error") === "auth_link");
    const saved = readPendingSignup();
    if (params.get("confirmed") === "1") {
      if (saved) setEmail(saved.email);
      forgetSignup();
      setMode("signin");
      setNotice("verified");
      // Consume this one-time notice so a later signup in the same tab can be
      // restored to its own verification step after a refresh.
      params.delete("confirmed");
      const remaining = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${remaining ? `?${remaining}` : ""}${window.location.hash}`);
    } else if (saved) {
      setEmail(saved.email);
      setResendAt(saved.resendAt);
      setClock(Date.now());
      setMode("verify");
    }
  }, []);

  useEffect(() => {
    if (mode !== "verify" || resendAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= resendAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mode, resendAt]);

  const resendSeconds = Math.max(0, Math.ceil((resendAt - clock) / 1000));

  function changeMode(next: Mode) {
    setMode(next); setError(""); setNotice(null); setBadLink(false);
    setPassword(""); setConfirm(""); setCode("");
    if (next !== "verify") { forgetSignup(); setResendAt(0); }
  }

  function signupRedirect(): string {
    // Keep links from older email templates usable during a gradual rollout.
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext())}`;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(null); setBadLink(false);
    if (mode === "signup" && password.length < 8) { setError(text.shortPassword); return; }
    if (mode === "signup" && password !== confirm) { setError(text.mismatch); return; }
    if (mode === "verify" && !/^\d{6,10}$/.test(code)) { setError(text.codeFormat); return; }
    setPending(true);
    try {
      const address = email.trim();
      if (mode === "signin") {
        const { error } = await browserSupabase().auth.signInWithPassword({ email: address, password });
        if (error) { setError(error.message); return; }
        forgetSignup();
        window.location.assign(safeNext());
      } else if (mode === "signup") {
        const supabase = browserSupabase();
        const { data, error } = await supabase.auth.signUp({
          email: address, password,
          options: { emailRedirectTo: signupRedirect(), data: { full_name: name.trim() } },
        });
        if (error) { setError(error.message); return; }
        setEmail(address); setPassword(""); setConfirm("");
        if (data.session) {
          // Some projects disable email confirmation. Respect the requested
          // sign-in step rather than silently carrying that session forward.
          let signOutFailed = false;
          try {
            const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
            signOutFailed = Boolean(signOutError);
          } catch { signOutFailed = true; }
          changeMode("signin");
          if (signOutFailed) setError(text.signOutError);
          else setNotice("autoConfirmed");
          return;
        }
        const now = Date.now();
        const nextResend = now + RESEND_DELAY_MS;
        rememberSignup({ email: address, resendAt: nextResend });
        setClock(now); setResendAt(nextResend); setCode(""); setMode("verify");
      } else if (mode === "verify") {
        const result = await verifySignupCode(address, code);
        if (!result.ok) { setError(result.reason === "invalid" ? text.codeInvalid : text.genericError); return; }
        setEmail(address);
        changeMode("signin");
        setNotice("verified");
      } else {
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`;
        const { error } = await browserSupabase().auth.resetPasswordForEmail(address, { redirectTo });
        if (error) { setError(error.message); return; }
        setNotice("checkReset");
      }
    } catch { setError(text.genericError); }
    finally { setPending(false); }
  }

  async function resend() {
    if (pending || Date.now() < resendAt) return;
    const address = email.trim();
    if (address.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(address)) { setError(text.validEmail); return; }
    setError(""); setNotice(null); setBadLink(false); setPending(true);
    try {
      const { error } = await browserSupabase().auth.resend({
        type: "signup", email: address, options: { emailRedirectTo: signupRedirect() },
      });
      if (error) {
        setError(error.status === 429 ? text.rateLimited : text.genericError);
        return;
      }
      const now = Date.now();
      const nextResend = now + RESEND_DELAY_MS;
      rememberSignup({ email: address, resendAt: nextResend });
      setEmail(address); setCode(""); setClock(now); setResendAt(nextResend); setNotice("codeResent");
    } catch { setError(text.genericError); }
    finally { setPending(false); }
  }

  async function signInWithVercel() {
    setError(""); setPending(true);
    try {
      const result = await authClient.signIn.social({ provider: "vercel", callbackURL: safeNext() });
      if (result.error) { setError(text.genericError); setPending(false); }
    } catch { setError(text.genericError); setPending(false); }
  }

  const showAccountOptions = mode === "signin" || mode === "signup";

  return (
    <AuthLayout language={language} onLanguageChange={changeLanguage}>
      <div className="auth-form-head">
        <span className="auth-small-label">{mode === "forgot" ? "ACCOUNT RECOVERY" : mode === "verify" ? "TFLASH / VERIFY EMAIL" : "TFLASH / ACCOUNT"}</span>
        <h2>{mode === "signin" ? text.welcome : mode === "signup" ? text.create : mode === "verify" ? text.verifyTitle : text.resetTitle}</h2>
        <p>{mode === "signin" ? text.welcomeBody : mode === "signup" ? text.createBody : mode === "verify" ? text.verifyBody : text.resetBody}</p>
      </div>
      {showAccountOptions ? (
        <div className="auth-tabs" aria-label="Account options">
          <button aria-pressed={mode === "signin"} disabled={pending} onClick={() => changeMode("signin")} type="button">{text.signIn}</button>
          <button aria-pressed={mode === "signup"} disabled={pending} onClick={() => changeMode("signup")} type="button">{text.signUp}</button>
        </div>
      ) : null}
      {showAccountOptions ? (
        <div className="auth-social">
          <button disabled={pending || !vercelAvailable} onClick={signInWithVercel} type="button">
            <svg aria-hidden="true" width="13" height="12" viewBox="0 0 24 20"><path d="M12 0 24 20H0L12 0Z" fill="currentColor" /></svg>
            {text.vercelSignIn}
          </button>
          {!vercelAvailable ? <p className="auth-social-unavailable">{text.vercelUnavailable}</p> : null}
          <div><span>{text.orEmail}</span></div>
        </div>
      ) : null}
      <form className={`auth-form${mode === "verify" || mode === "forgot" ? " auth-reset-form" : ""}`} onSubmit={submit}>
        {mode === "signup" ? (
          <div className="auth-field"><label htmlFor="name">{text.name}</label><input autoComplete="name" id="name" maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={text.namePlaceholder} required value={name} /></div>
        ) : null}
        <div className="auth-field"><label htmlFor="email">{text.email}</label><input autoComplete="email" id="email" maxLength={254} onChange={(event) => setEmail(event.target.value)} placeholder={text.emailPlaceholder} required type="email" value={email} /></div>
        {mode === "verify" ? (
          <div className="auth-field">
            <label htmlFor="verification-code">{text.verificationCode}</label>
            <input autoComplete="one-time-code" autoFocus className="auth-code-input" id="verification-code" inputMode="numeric" maxLength={10} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder={text.codePlaceholder} required type="text" value={code} />
          </div>
        ) : null}
        {mode === "signin" || mode === "signup" ? (
          <PasswordInput autoComplete={mode === "signin" ? "current-password" : "new-password"} hideLabel={text.hide} id="password" label={text.password} minLength={mode === "signup" ? 8 : undefined} onChange={setPassword} placeholder={mode === "signup" ? text.createPassword : text.passwordPlaceholder} showLabel={text.show} value={password} />
        ) : null}
        {mode === "signup" ? (
          <PasswordInput autoComplete="new-password" hideLabel={text.hide} id="confirm-password" label={text.confirm} minLength={8} onChange={setConfirm} placeholder={text.confirmPlaceholder} showLabel={text.show} value={confirm} />
        ) : null}
        {mode === "signin" ? <button className="auth-forgot" disabled={pending} onClick={() => changeMode("forgot")} type="button">{text.forgot}</button> : null}
        {error || badLink ? <p className="auth-message auth-message-error" role="alert">{error || text.linkError}</p> : null}
        {notice ? <p className="auth-message auth-message-success" role="status">{text[notice]}</p> : null}
        <button className="auth-submit" disabled={pending} type="submit">
          <span>{pending ? text.saving : mode === "signin" ? text.continue : mode === "signup" ? text.createButton : mode === "verify" ? text.verifyButton : text.sendLink}</span>
          {pending ? <LoaderCircleIcon className="animate-spin" size={18} /> : <ArrowRightIcon size={18} />}
        </button>
        {mode === "verify" ? (
          <div className="auth-verification-actions">
            <button className="auth-back" disabled={pending || resendSeconds > 0} onClick={resend} type="button">
              {resendSeconds > 0 ? text.resendIn(resendSeconds) : text.resendCode}
            </button>
            <button className="auth-back" disabled={pending} onClick={() => changeMode("signin")} type="button"><ArrowLeftIcon size={15} />{text.back}</button>
          </div>
        ) : null}
        {mode === "signin" ? <button className="auth-back" disabled={pending} onClick={() => changeMode("verify")} type="button">{text.haveCode}</button> : null}
        {mode === "forgot" ? <button className="auth-back" disabled={pending} onClick={() => changeMode("signin")} type="button"><ArrowLeftIcon size={15} />{text.back}</button> : null}
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordScreen() {
  const { language, changeLanguage, text } = useLanguage();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (password.length < 8) { setError(text.shortPassword); return; }
    if (password !== confirm) { setError(text.mismatch); return; }
    setPending(true);
    try {
      const { error } = await browserSupabase().auth.updateUser({ password });
      if (error) { setError(error.message); return; }
      setNotice(text.passwordDone);
      window.location.assign("/");
    } catch { setError(text.genericError); }
    finally { setPending(false); }
  }
  return (
    <AuthLayout language={language} onLanguageChange={changeLanguage}>
      <div className="auth-form-head"><span className="auth-small-label">ACCOUNT RECOVERY</span><h2>{text.passwordTitle}</h2><p>{text.passwordBody}</p></div>
      <form className="auth-form auth-reset-form" onSubmit={submit}>
        <PasswordInput autoComplete="new-password" hideLabel={text.hide} id="new-password" label={text.newPassword} minLength={8} onChange={setPassword} placeholder={text.createPassword} showLabel={text.show} value={password} />
        <PasswordInput autoComplete="new-password" hideLabel={text.hide} id="confirm-password" label={text.confirm} minLength={8} onChange={setConfirm} placeholder={text.confirmPlaceholder} showLabel={text.show} value={confirm} />
        {error ? <p className="auth-message auth-message-error" role="alert">{error}</p> : null}
        {notice ? <p className="auth-message auth-message-success" role="status">{notice}</p> : null}
        <button className="auth-submit" disabled={pending} type="submit"><span>{pending ? text.saving : text.savePassword}</span><ArrowRightIcon size={18} /></button>
      </form>
    </AuthLayout>
  );
}
