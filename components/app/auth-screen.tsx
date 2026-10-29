"use client";

import { ArrowLeftIcon, ArrowRightIcon, EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { browserSupabase } from "@/lib/supabase/browser";
import { authClient } from "@/lib/auth-client";
import { safeLocalPath } from "@/lib/security/redirect";
import { Brand } from "./brand";

type Language = "en" | "so";
type Mode = "signin" | "signup" | "forgot";

const words = {
  en: {
    about: "About Tflash",
    language: "Language",
    accountOptions: "Account options",
    hero: "One workspace",
    heroEm: "for your AI models.",
    heroBody: "Choose a provider, connect tools, and get to work.",
    signIn: "Sign in",
    vercelSignIn: "Continue with Vercel",
    orEmail: "or use email",
    vercelUnavailable: "Vercel sign-in is not configured on this deployment.",
    signUp: "Create account",
    welcome: "Sign in to Tflash.",
    welcomeBody: "Choose a sign-in method.",
    create: "Create your account.",
    createBody: "Use email or continue with Vercel.",
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
    checkSignup: "Check your inbox for a confirmation link. Open it in this browser to finish creating your account.",
    checkReset: "If an account exists for that email, a reset link is on its way. Open it in this browser.",
    mismatch: "Passwords do not match.",
    shortPassword: "Use at least 8 characters for your password.",
    show: "Show password",
    hide: "Hide password",
    linkError: "That link has expired or could not be verified. Please request a new one.",
    genericError: "Something went wrong. Please try again.",
    passwordTitle: "Choose a new password.",
    passwordBody: "Use a password you haven’t used before.",
    savePassword: "Update password",
    passwordDone: "Password updated. Taking you to your workspace…",
  },
  so: {
    about: "Ku saabsan Tflash",
    language: "Luqadda",
    accountOptions: "Doorashooyinka akoonka",
    hero: "Modelada AI.",
    heroEm: "Hal goob.",
    heroBody: "Dooro bixiye, ku xir qalabkaaga, kuna bilow shaqada.",
    signIn: "Soo gal",
    vercelSignIn: "Ku sii wad Vercel",
    orEmail: "ama isticmaal email",
    vercelUnavailable: "Vercel sign-in looma diyaarin noocan.",
    signUp: "Samee akoon",
    welcome: "Soo gal Tflash.",
    welcomeBody: "Dooro habka aad ku soo galayso.",
    create: "Samee akoon.",
    createBody: "Isticmaal email ama Vercel.",
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
    checkSignup: "Ka eeg email-kaaga xiriirka xaqiijinta. Ka fur browser-kan si aad akoonka u dhammaystirto.",
    checkReset: "Haddii akoon email-kan ku jiro, xiriirka dib-u-dejinta waa la dirayaa. Ka fur browser-kan.",
    mismatch: "Labada fure isma laha.",
    shortPassword: "Furahaagu ha ka koobnaado ugu yaraan 8 xaraf.",
    show: "Muuji furaha",
    hide: "Qari furaha",
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
    <main id="main-content" tabIndex={-1} className="auth-shell">
      <section className="auth-story" aria-label={text.about}>
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
        </div>
        <div className="auth-story-copy">
          <h1>{text.hero}<br /><em>{text.heroEm}</em></h1>
          <p className="auth-story-description">{text.heroBody}</p>
        </div>
        <div className="auth-story-footer">© {new Date().getFullYear()} Tflash</div>
      </section>
      <section className="auth-panel">
        <div className="auth-mobile-brand"><Brand /></div>
        <div className="auth-panel-top">
          <div className="auth-language" aria-label={text.language}>
            <button aria-pressed={language === "en"} onClick={() => onLanguageChange("en")} type="button">EN</button>
            <span>/</span>
            <button aria-pressed={language === "so"} onClick={() => onLanguageChange("so")} type="button">SO</button>
          </div>
        </div>
        <div className="auth-panel-content">{children}</div>
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

export function AuthScreen({ vercelAvailable }: { readonly vercelAvailable: boolean }) {
  const { language, changeLanguage, text } = useLanguage();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [badLink, setBadLink] = useState(false);

  useEffect(() => { setBadLink(new URLSearchParams(window.location.search).get("error") === "auth_link"); }, []);

  function changeMode(next: Mode) {
    setMode(next); setError(""); setNotice(""); setBadLink(false); setPassword(""); setConfirm("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBadLink(false);
    if (mode === "signup" && password.length < 8) { setError(text.shortPassword); return; }
    if (mode === "signup" && password !== confirm) { setError(text.mismatch); return; }
    setPending(true);
    try {
      const supabase = browserSupabase();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) { setError(error.message); return; }
        window.location.assign(safeNext());
      } else if (mode === "signup") {
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext())}`;
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { emailRedirectTo: redirectTo, data: { full_name: name.trim() } },
        });
        if (error) { setError(error.message); return; }
        if (data.session) { window.location.assign(safeNext()); return; }
        setNotice(text.checkSignup); setPassword(""); setConfirm("");
      } else {
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`;
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (error) { setError(error.message); return; }
        setNotice(text.checkReset);
      }
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

  return (
    <AuthLayout language={language} onLanguageChange={changeLanguage}>
      <div className="auth-form-head">
        <h2>{mode === "signin" ? text.welcome : mode === "signup" ? text.create : text.resetTitle}</h2>
        <p>{mode === "signin" ? text.welcomeBody : mode === "signup" ? text.createBody : text.resetBody}</p>
      </div>
      {mode !== "forgot" ? (
        <div className="auth-tabs" aria-label={text.accountOptions}>
          <button aria-pressed={mode === "signin"} onClick={() => changeMode("signin")} type="button">{text.signIn}</button>
          <button aria-pressed={mode === "signup"} onClick={() => changeMode("signup")} type="button">{text.signUp}</button>
        </div>
      ) : null}
      {mode !== "forgot" ? (
        <div className="auth-social">
          <button disabled={pending || !vercelAvailable} onClick={signInWithVercel} type="button">
            <svg aria-hidden="true" width="13" height="12" viewBox="0 0 24 20"><path d="M12 0 24 20H0L12 0Z" fill="currentColor" /></svg>
            {text.vercelSignIn}
          </button>
          {!vercelAvailable ? <p className="auth-social-unavailable">{text.vercelUnavailable}</p> : null}
          <div><span>{text.orEmail}</span></div>
        </div>
      ) : null}
      <form className="auth-form" onSubmit={submit}>
        {mode === "signup" ? (
          <div className="auth-field"><label htmlFor="name">{text.name}</label><input autoComplete="name" id="name" maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={text.namePlaceholder} required value={name} /></div>
        ) : null}
        <div className="auth-field"><label htmlFor="email">{text.email}</label><input autoComplete="email" id="email" onChange={(event) => setEmail(event.target.value)} placeholder={text.emailPlaceholder} required type="email" value={email} /></div>
        {mode !== "forgot" ? (
          <PasswordInput autoComplete={mode === "signin" ? "current-password" : "new-password"} hideLabel={text.hide} id="password" label={text.password} minLength={mode === "signup" ? 8 : undefined} onChange={setPassword} placeholder={mode === "signup" ? text.createPassword : text.passwordPlaceholder} showLabel={text.show} value={password} />
        ) : null}
        {mode === "signup" ? (
          <PasswordInput autoComplete="new-password" hideLabel={text.hide} id="confirm-password" label={text.confirm} minLength={8} onChange={setConfirm} placeholder={text.confirmPlaceholder} showLabel={text.show} value={confirm} />
        ) : null}
        {mode === "signin" ? <button className="auth-forgot" onClick={() => changeMode("forgot")} type="button">{text.forgot}</button> : null}
        {error || badLink ? <p className="auth-message auth-message-error" role="alert">{error || text.linkError}</p> : null}
        {notice ? <p className="auth-message auth-message-success" role="status">{notice}</p> : null}
        <button className="auth-submit" disabled={pending} type="submit">
          <span>{pending ? text.saving : mode === "signin" ? text.continue : mode === "signup" ? text.createButton : text.sendLink}</span>
          {pending ? <LoaderCircleIcon className="animate-spin" size={18} /> : <ArrowRightIcon size={18} />}
        </button>
        {mode === "forgot" ? <button className="auth-back" onClick={() => changeMode("signin")} type="button"><ArrowLeftIcon size={15} />{text.back}</button> : null}
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
      <div className="auth-form-head"><h2>{text.passwordTitle}</h2><p>{text.passwordBody}</p></div>
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
