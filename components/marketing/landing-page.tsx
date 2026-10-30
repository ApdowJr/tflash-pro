"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  CheckIcon,
  FileTextIcon,
  KeyRoundIcon,
  LanguagesIcon,
  ListChecksIcon,
  MicIcon,
  PlugZapIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WaypointsIcon,
} from "lucide-react";
import { Brand } from "@/components/app/brand";

type Language = "en" | "so";

const PROVIDERS = [
  "Vercel AI Gateway",
  "OpenRouter",
  "OpenAI",
  "Anthropic",
  "Google Gemini",
  "Groq",
  "Mistral AI",
  "DeepSeek",
  "xAI",
  "Together AI",
  "Fireworks AI",
  "Cerebras",
  "Ollama",
  "LM Studio",
  "Custom endpoint",
] as const;

const FEATURE_ICONS = [
  LanguagesIcon,
  SparklesIcon,
  PlugZapIcon,
  SearchCheckIcon,
  FileTextIcon,
  MicIcon,
  ShieldCheckIcon, // Market agent out-approve feature
] as const;

const copy = {
  en: {
    navProduct: "Product",
    navFeatures: "Features",
    navProviders: "Providers",
    navSecurity: "Privacy",
    navLabel: "Primary",
    signIn: "Sign in",
    getStarted: "Get started",
    language: "Language",
    badge: "Somali + English · one calm workspace",
    heroA: "An AI workspace that",
    heroEm: "speaks your language.",
    heroBody:
      "Talk to the model you choose, connect the tools you already use, and turn the answer into something you can send. Tflash keeps Somali and English side by side, without the clutter.",
    ctaPrimary: "Start a conversation",
    ctaSecondary: "See how it works",
    trust: "Email or Vercel sign-in · Your provider keys stay yours",
    previewTitle: "New chat",
    previewStatus: "Approval required",
    previewUser: "Start a 7-day plan about learning Python, and make the result beautiful.",
    previewReply: "Good. Here is the plan, organized in 7 days:",
    previewSteps: ["Day 1–2 · Syntax and variables", "Day 3–4 · Functions and files", "Day 5–7 · One small project"],
    previewTool: "web_fetch · docs.python.org",
    previewToolNote: "Reading a public page · waiting for your approval",
    previewApprove: "Approve",
    previewReview: "Review",
    overviewKicker: "Why Tflash",
    overviewTitle: "Less switching. More finishing.",
    overviewBody:
      "A single, quiet surface for the whole loop: ask, research, approve, produce, and keep the result. No tab hopping between a chat box, a notes app and a document converter.",
    featureKicker: "Features",
    featureTitle: "Built for real work, in two languages.",
    features: [
      {
        title: "Somali and English, together",
        body: "The interface is bilingual and the assistant replies in the language you write in. Technical terms stay intact.",
      },
      {
        title: "Every model, one selector",
        body: "Switch between 15 providers — from AI Gateway and OpenRouter to local Ollama — per conversation, per turn.",
      },
      {
        title: "Your tools, connected",
        body: "Ten approval-gated connections: GitHub, Notion, Linear, Supabase, Neon, Sentry, Stripe, Vercel, PostHog and Resend.",
      },
      {
        title: "Research with receipts",
        body: "Read public pages, keep the requested URL, retrieval time and excerpt, then cite what actually supports the claim.",
      },
      {
        title: "Answers become files",
        body: "Preview and download Markdown, text, CSV or JSON — or convert plain text to a real PDF or DOCX on demand.",
      },
      {
        title: "Your voice, your pace",
        body: "Dictate in Somali or English, and have a finished reply read back. Speech support depends on your browser and device.",
      },
      {
        title: "Market agent out-approve workflow",
        body: "Deploy agent tasks to the market with an out-approve flag. If the out-approve state is active, the system requests the user’s explicit permission before sending the job.",
      },
    ],
    stepsKicker: "How it works",
    stepsTitle: "Three moves, from question to result.",
    steps: [
      {
        title: "Pick a model",
        body: "Use the project gateway or add your own key in Settings → Providers. Test the connection before you rely on it.",
      },
      {
        title: "Ask, attach, or delegate",
        body: "Start a chat, import a PDF or DOCX, or ask for research. Shell commands and connected tools wait for your approval.",
      },
      {
        title: "Take the work with you",
        body: "Download the document or report, copy the answer, or come back later — your conversations stay tied to your account.",
      },
    ],
    providersKicker: "Providers",
    providersTitle: "Bring the model you already trust.",
    providersBody:
      "One interface, many backends. Operator keys are optional; browser keys are encrypted on the server and bound to your signed-in account.",
    providersNote: "Ollama, LM Studio and custom endpoints are reached from the server and must be explicitly allowed in production.",
    securityKicker: "Privacy",
    securityTitle: "Approval is the default, not a setting.",
    securityPoints: [
      {
        title: "Keys never come back in the clear",
        body: "Browser-supplied provider keys are encrypted with AES-GCM and represented by an opaque, account-bound token that expires after seven days.",
      },
      {
        title: "Every external call asks first",
        body: "Shell commands and each MCP tool call require a fresh in-chat approval. A plan never grants permission to execute a step.",
      },
      {
        title: "Conversations stay owned",
        body: "Supabase history uses row-level security and signed ownership proofs. There are no public share links to leak by accident.",
      },
    ],
    securityNote:
      "No product can promise perfect security. The README documents the real limits, including storage retention, known costs and the boundaries of approvals.",
    faqKicker: "Questions",
    faqTitle: "The short answers.",
    faqs: [
      {
        q: "Is Tflash free?",
        a: "Using your own provider key means you pay that provider directly. Tflash itself has no subscription; some gateway models are free, and availability is set by the provider.",
      },
      {
        q: "Do I need an account?",
        a: "Yes — sign in with email and password, or continue with Vercel. The two are separate accounts, even with the same email, and do not share history.",
      },
      {
        q: "Does Somali work everywhere?",
        a: "The interface and the assistant do. Speech recognition and installed voices are provided by your browser or device, and Somali support is not guaranteed — review dictated text before sending.",
      },
      {
        q: "Where does my data live?",
        a: "Transcripts live in Eve workflow storage; chat titles and index data live in Supabase, or in this browser for Vercel sign-in. Projects and notes are browser-local. Never store secrets in notes.",
      },
      {
        q: "Can I use it offline?",
        a: "No. Tflash needs a connection to reach your chosen provider. The offline banner only reports the browser's link state, not server health.",
      },
    ],
    finalKicker: "Ready when you are",
    finalTitle: "Start with a question. Finish with a file.",
    finalBody: "Sign in, choose a model, and see what a calmer workspace feels like.",
    finalCta: "Open Tflash",
    footerTagline: "A bilingual AI workspace for chat, research and finished work.",
    footerSignIn: "Sign in",
    footerCreate: "Create account",
    footerDocs: "Documentation",
    footerSource: "Source on GitHub",
    footerLabel: "Footer",
    footerNote: "Tflash is an independent project. Model names and marks belong to their owners.",
  },
  so: {
    navProduct: "Adeegga",
    navFeatures: "Astaamaha",
    navProviders: "Bixiyeyaasha",
    navSecurity: "Asturnaanta",
    navLabel: "Hagaha ugu muhiimsan",
    signIn: "Soo gal",
    getStarted: "Bilow",
    language: "Luqadda",
    badge: "Soomaali + English · hal goob oo deggan",
    heroA: "Goob AI ah oo ku hadasha",
    heroEm: "luqaddaada.",
    heroBody:
      "La hadal modelka aad dooratay, ku xir qalabka aad horey u isticmaashay, oo jawaabta u beddel wax aad dirto. Tflash waxay Soomaali iyo English isla haysaa, iyada oo aan buuq la'aan.",
    ctaPrimary: "Bilow wada hadal",
    ctaSecondary: "Arag sida loo shaqeeyo",
    trust: "Email ama Vercel · Furahaaga bixiyaha adigaa iska leh",
    previewTitle: "Wada hadal cusub",
    previewStatus: "Fasax ayaa loo baahan yahay",
    previewUser: "Bilow qorshe 7 maalin ah oo ku saabsan barashada Python, oo ku samee quruxda natiijada.",
    previewReply: "Waa hagaag. Waa kan qorshaha, oo la habeeyay 7 maalin:",
    previewSteps: ["Maalin 1–2 · Syntax iyo variables", "Maalin 3–4 · Functions iyo files", "Maalin 5–7 · Hal mashruuc yar"],
    previewTool: "web_fetch · docs.python.org",
    previewToolNote: "Bog dadweyne ayaa la akhrinayaa · fasaxaaga ayaa la sugayaa",
    previewApprove: "Oggolow",
    previewReview: "Eeg",
    overviewKicker: "Maxaa Tflash",
    overviewTitle: "Yaraan beddelaad. Badnaan dhammaystir.",
    overviewBody:
      "Hal goob oo deggan oo hawsha oo dhan qabta: weydii, baadh, oggolow, soo saar, oo natiijada hayso. Ma u baahnid inaad u dhex wareegto chat, notes iyo converter.",
    featureKicker: "Astaamaha",
    featureTitle: "Loo dhisay shaqo dhab ah, laba luqadood.",
    features: [
      {
        title: "Soomaali iyo English, wada jir",
        body: "Interface-ka waa laba luqadood, kaaliyuhuna wuxuu ku jawaabaa luqadda aad ku qorto. Erayada farsamada waxay ahaanayaan sidoodii.",
      },
      {
        title: "Model kasta, hal selector",
        body: "U dhex beddel 15 bixiye — AI Gateway iyo OpenRouter ilaa Ollama maxalli ah — wada hadal kasta, mar kasta.",
      },
      {
        title: "Qalabkaaga, oo xiran",
        body: "Toban xiriir oo fasax lagu xakameeyo: GitHub, Notion, Linear, Supabase, Neon, Sentry, Stripe, Vercel, PostHog iyo Resend.",
      },
      {
        title: "Baaritaan leh caddayn",
        body: "Akhri boggaga dadweynaha, hayso URL-ka la codsaday, waqtiga iyo qaybta, kadibna tirso waxa dhabta ah oo sheegtay taageeraya.",
      },
      {
        title: "Jawaabtu waxay noqotaa fayl",
        body: "Eeg oo soo deg Markdown, text, CSV ama JSON — ama u beddel qoraal cad PDF ama DOCX dhab ah markaad codsato.",
      },
      {
        title: "Codkaaga, xawaarahaaga",
        body: "Ku qor Soomaali ama English, oo jawaabta dhammaystiran dib u maqal. Taageerada codku waxay ku xiran tahay browser-kaaga iyo qalabkaaga.",
      },
      {
        title: "Shaqo-dirka agent ee suuqa (out-approve)",
        body: "Dir shaqooyinka agent-ka suuqa iyada oo leh astaanta out-approve. Haddii astaanta out-approve ay jirto, nidaamku wuxuu codsadaa ogolaanshaha isticmaalaha kahor inta aan shaqada la dirin.",
      },
    ],
    stepsKicker: "Sida loo shaqeeyo",
    stepsTitle: "Saddex tallaabo, su'aal ilaa natiijo.",
    steps: [
      {
        title: "Dooro model",
        body: "Isticmaal gateway-ga mashruuca ama ku dar furahaaga gaar ah Settings → Providers. Tijaabi xiriirka ka hor intaadan ku tiirsanaan.",
      },
      {
        title: "Weydii, lifaaq, ama u dir",
        body: "Bilow wada hadal, soo geli PDF ama DOCX, ama codso baaritaan. Amarrada shell iyo qalabka xiran waxay sugayaan fasaxaaga.",
      },
      {
        title: "Qaado shaqada",
        body: "Soo deg dukumentiga ama warbixinta, koobi jawaabta, ama dib u soo noqo — wada hadalladaadu waxay ku xiran yihiin akoonkaaga.",
      },
    ],
    providersKicker: "Bixiyeyaasha",
    providersTitle: "Keen modelka aad horey u aaminsanayd.",
    providersBody:
      "Hal interface, bixiyeyaal badan. Furaha operator-ka waa ikhtiyaar; furaha browser-ka waxaa lagu sireeyaa server-ka oo lagu xiraa akoonkaaga.",
    providersNote: "Ollama, LM Studio iyo endpoints gaar ah waxaa laga gaaraa server-ka, producton-ka waa in si cad loo oggolaadaa.",
    securityKicker: "Asturnaanta",
    securityTitle: "Fasax waa default-ka, ma aha setting.",
    securityPoints: [
      {
        title: "Furahaaga lama soo celiyo si cad",
        body: "Furaha bixiyaha ee browser-ku bixiyo waxaa lagu sireeyaa AES-GCM, waxaana matala token qarsoon oo akoonkaaga ku xiran oo toddoba maalmood kadib dhacaya.",
      },
      {
        title: "Wicitaan kasta oo dibadda ah waxay marka hore weydiistaa",
        body: "Amarrada shell iyo qalab kasta oo MCP waxay u baahan yihiin fasax cusub oo ku jira wada hadalka. Qorshe waligeed ma bixiso ogolaansho fulin.",
      },
      {
        title: "Wada hadallada leh milkiilayaal",
        body: "Taariikhda Supabase waxay isticmaashaa row-level security iyo caddayn milkiile la saxeexay. Ma jiraan xiriir dadweyne oo si lama filaan ah u bixin kara.",
      },
    ],
    securityNote:
      "Ma jiro badeecad dammaanad qaadi karta amni qumman. README-gu wuxuu qeexayaa xaddidaadaha dhabta ah, oo ay ku jiraan kaydinta, kharashka la yaqaan iyo xadka fasaxyada.",
    faqKicker: "Su'aalo",
    faqTitle: "Jawaabaha gaaban.",
    faqs: [
      {
        q: "Tflash ma bilaash baa?",
        a: "Haddii aad isticmaasho furahaaga bixiyaha, waxaad si toos ah u bixisaa bixiyahaas. Tflash laftiisu ma leh subscription; modelada gateway qaar waa bilaash, helitaankana waxaa go'aamiya bixiyaha.",
      },
      {
        q: "Akoon ma u baahanahay?",
        a: "Haa — ku soo gal email iyo furaha, ama ku sii wad Vercel. Labaduba waa akoono gooni ah, xitaa isla email, waxbana ma wadaagaan taariikh.",
      },
      {
        q: "Soomaali ma ka shaqaysaa meel kasta?",
        a: "Interface-ka iyo kaaliyuhu haa. Aqoonsiga codka iyo codadka la rakibay waxaa bixiya browser-kaaga ama qalabkaaga, taageerada Soomaaligana lama dammaanad qaadin — dib u eeg qoraalka codka ka hor intaadan dirin.",
      },
      {
        q: "Xogtaydu xaggee ku nooshahay?",
        a: "Transcript-yada waxay ku jiraan Eve workflow storage; cinwaannada iyo index-ka waxay ku jiraan Supabase, ama browser-kan haddii Vercel lagu soo galo. Projects iyo notes waa browser-local. Waligaa ha kaydiyo sir ku jira notes.",
      },
      {
        q: "Offline ma isticmaali karaa?",
        a: "Maya. Tflash waxay u baahan tahay xiriir si ay u gaarto bixiyaha aad dooratay. Banner-ka offline wuxuu sheegayaa xaaladda browser-ka oo keliya, ma aha caafimaadka server-ka.",
      },
    ],
    finalKicker: "Diyaar markaad tahay",
    finalTitle: "Ku bilow su'aal. Ku dhammee fayl.",
    finalBody: "Soo gal, dooro model, oo arag sida goob deggan ay u tahay.",
    finalCta: "Fur Tflash",
    footerTagline: "Goob AI laba luqadood ah oo loogu talagalay wada hadal, baaritaan iyo shaqo dhammaystiran.",
    footerSignIn: "Soo gal",
    footerCreate: "Samee akoon",
    footerDocs: "Dukumentiyada",
    footerSource: "Source GitHub",
    footerLabel: "Qaybta hoose",
    footerNote: "Tflash waa mashruuc madax bannaan. Magacyada iyo calaamadaha modelada waxaa iska leh milkiilayaashooda.",
  },
} as const;

function useLanguage() {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    try {
      if (localStorage.getItem("tflash:language") === "so") setLanguage("so");
    } catch {
      /* Storage may be disabled. */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    try {
      localStorage.setItem("tflash:language", next);
    } catch {
      /* private browsing */
    }
  };

  return { language, changeLanguage, text: copy[language] };
}

function OrbitArt() {
  return (
    <svg aria-hidden="true" className="lp-orbit" fill="none" viewBox="0 0 560 460" xmlns="http://www.w3.org/2000/svg">
      <circle cx="280" cy="230" r="186" stroke="#f2e8d5" strokeOpacity=".1" />
      <circle cx="280" cy="230" r="142" stroke="#f2e8d5" strokeOpacity=".12" />
      <ellipse cx="280" cy="230" rx="230" ry="74" stroke="#eac983" strokeOpacity=".4" transform="rotate(-26 280 230)" />
      <ellipse cx="280" cy="230" rx="230" ry="74" stroke="#eac983" strokeOpacity=".2" transform="rotate(26 280 230)" />
      <path d="M98 356 462 106" stroke="#eac983" strokeOpacity=".18" />
      <path d="M280 44v372" stroke="#7b8a73" strokeOpacity=".2" strokeDasharray="3 9" />
      <path d="M50 230h460" stroke="#7b8a73" strokeOpacity=".2" strokeDasharray="3 9" />
      <circle cx="104" cy="298" r="5" fill="#f3bd56" />
      <circle cx="456" cy="164" r="3.5" fill="#f2e8d5" />
      <circle cx="280" cy="230" r="4" fill="#f3bd56" />
      <path d="M78 74h42M78 74v42M482 386h-42M482 386v-42" stroke="#f2e8d5" strokeOpacity=".2" />
    </svg>
  );
}

function ChatPreview({ text }: { readonly text: (typeof copy)[Language] }) {
  return (
    <div aria-hidden="true" className="lp-preview-wrap">
      <div className="lp-preview">
        <div className="lp-preview-top">
          <span className="lp-preview-dots"><i /><i /><i /></span>
          <span className="lp-preview-title">{text.previewTitle}</span>
          <span className="lp-preview-model"><i />Vercel AI Gateway</span>
        </div>
        <div className="lp-preview-body">
          <div className="lp-bubble lp-bubble-user">{text.previewUser}</div>
          <div className="lp-bubble lp-bubble-agent">
            <p>{text.previewReply}</p>
            <ul>
              {text.previewSteps.map((step) => (
                <li key={step}><CheckIcon size={12} strokeWidth={2.4} />{step}</li>
              ))}
            </ul>
          </div>
          <div className="lp-approval">
            <div className="lp-approval-head">
              <span className="lp-approval-icon"><ShieldCheckIcon size={14} /></span>
              <span>{text.previewTool}</span>
              <em>{text.previewStatus}</em>
            </div>
            <p>{text.previewToolNote}</p>
            <div className="lp-approval-actions">
              <span className="lp-approval-primary">{text.previewApprove}</span>
              <span className="lp-approval-ghost">{text.previewReview}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="lp-preview-badge"><BadgeCheckIcon size={14} />Somali + English</div>
    </div>
  );
}

export function LandingPage() {
  const { language, changeLanguage, text } = useLanguage();

  return (
    <main className="lp-shell" id="main-content" tabIndex={-1}>
      <header className="lp-hero">
        <div className="lp-hero-glow" aria-hidden="true" />
        <OrbitArt />
        <nav aria-label={text.navLabel} className="lp-nav">
          <Link aria-label="Tflash" className="lp-brand" href="/">
            <Brand inverted />
          </Link>
          <div className="lp-nav-links">
            <a href="#features">{text.navFeatures}</a>
            <a href="#providers">{text.navProviders}</a>
            <a href="#security">{text.navSecurity}</a>
            <a href="#faq">{text.faqKicker}</a>
          </div>
          <div className="lp-nav-actions">
            <div aria-label={text.language} className="lp-language" role="group">
              <button aria-pressed={language === "en"} onClick={() => changeLanguage("en")} type="button">EN</button>
              <span>/</span>
              <button aria-pressed={language === "so"} onClick={() => changeLanguage("so")} type="button">SO</button>
            </div>
            <Link className="lp-signin" href="/login">{text.signIn}</Link>
            <Link className="lp-nav-cta" href="/login?mode=signup">{text.getStarted}</Link>
          </div>
        </nav>

        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <p className="lp-badge"><SparklesIcon size={13} />{text.badge}</p>
            <h1>{text.heroA} <em>{text.heroEm}</em></h1>
            <p className="lp-hero-body">{text.heroBody}</p>
            <div className="lp-hero-actions">
              <Link className="lp-button lp-button-gold" href="/login?mode=signup">
                {text.ctaPrimary}<ArrowRightIcon size={16} />
              </Link>
              <a className="lp-button lp-button-ghost" href="#how">{text.ctaSecondary}</a>
            </div>
            <p className="lp-trust"><CheckIcon size={13} />{text.trust}</p>
          </div>
          <ChatPreview text={text} />
        </div>
      </header>

      <section className="lp-section lp-overview">
        <div className="lp-inner lp-overview-grid">
          <div>
            <p className="lp-kicker">{text.overviewKicker}</p>
            <h2 className="lp-title">{text.overviewTitle}</h2>
          </div>
          <p className="lp-lede">{text.overviewBody}</p>
        </div>
      </section>

      <section className="lp-section lp-features-section" id="features">
        <div className="lp-inner">
          <p className="lp-kicker">{text.featureKicker}</p>
          <h2 className="lp-title lp-title-wide">{text.featureTitle}</h2>
          <div className="lp-feature-grid">
            {text.features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index] ?? SparklesIcon;
              return (
                <article className="lp-card" key={feature.title}>
                  <span className="lp-card-icon"><Icon size={18} /></span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="lp-section lp-how" id="how">
        <div className="lp-inner">
          <p className="lp-kicker">{text.stepsKicker}</p>
          <h2 className="lp-title">{text.stepsTitle}</h2>
          <ol className="lp-steps">
            {text.steps.map((step, index) => (
              <li key={step.title}>
                <span className="lp-step-number">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section lp-providers" id="providers">
        <div className="lp-inner">
          <div className="lp-providers-head">
            <div>
              <p className="lp-kicker">{text.providersKicker}</p>
              <h2 className="lp-title">{text.providersTitle}</h2>
            </div>
            <p className="lp-lede">{text.providersBody}</p>
          </div>
          <ul className="lp-provider-list">
            {PROVIDERS.map((provider) => (
              <li key={provider}><WaypointsIcon size={14} />{provider}</li>
            ))}
          </ul>
          <p className="lp-fineprint">{text.providersNote}</p>
        </div>
      </section>

      <section className="lp-section lp-security-section" id="security">
        <div className="lp-inner">
          <div className="lp-security">
            <div className="lp-security-head">
              <p className="lp-kicker">{text.securityKicker}</p>
              <h2 className="lp-title">{text.securityTitle}</h2>
            </div>
            <div className="lp-security-grid">
              {text.securityPoints.map((point, index) => {
                const Icon = index === 0 ? KeyRoundIcon : index === 1 ? ShieldCheckIcon : ListChecksIcon;
                return (
                  <article key={point.title}>
                    <span><Icon size={19} /></span>
                    <h3>{point.title}</h3>
                    <p>{point.body}</p>
                  </article>
                );
              })}
            </div>
            <p className="lp-security-note">{text.securityNote}</p>
          </div>
        </div>
      </section>

      <section className="lp-section lp-faq" id="faq">
        <div className="lp-inner lp-faq-grid">
          <div>
            <p className="lp-kicker">{text.faqKicker}</p>
            <h2 className="lp-title">{text.faqTitle}</h2>
          </div>
          <div className="lp-faq-list">
            {text.faqs.map((faq) => (
              <details key={faq.q}>
                <summary>{faq.q}<span aria-hidden="true">+</span></summary>
                <p>{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section lp-final-section">
        <div className="lp-inner">
          <div className="lp-final">
            <p className="lp-kicker">{text.finalKicker}</p>
            <h2>{text.finalTitle}</h2>
            <p>{text.finalBody}</p>
            <Link className="lp-button lp-button-gold" href="/login?mode=signup">
              {text.finalCta}<ArrowRightIcon size={16} />
            </Link>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-inner lp-footer-grid">
          <div>
            <Brand />
            <p>{text.footerTagline}</p>
          </div>
          <nav aria-label={text.footerLabel} className="lp-footer-links">
            <Link href="/login">{text.footerSignIn}</Link>
            <Link href="/login?mode=signup">{text.footerCreate}</Link>
            <a href="https://github.com/ApdowJr/tflash-pro#readme" rel="noreferrer" target="_blank">{text.footerDocs}</a>
            <a href="https://github.com/ApdowJr/tflash-pro" rel="noreferrer" target="_blank">{text.footerSource}</a>
          </nav>
        </div>
        <div className="lp-inner lp-footer-bottom">
          <span>© {new Date().getFullYear()} Tflash</span>
          <span>{text.footerNote}</span>
        </div>
      </footer>
    </main>
  );
}
