"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  CheckIcon,
  Code2Icon,
  FileSearchIcon,
  FileTextIcon,
  KeyRoundIcon,
  LanguagesIcon,
  ListChecksIcon,
  MessageSquareTextIcon,
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
  ShieldCheckIcon,
] as const;

const MODE_TILES = {
  en: [
    { title: "Chat", icon: MessageSquareTextIcon, body: "Quick answers, context, and follow-up conversations" },
    { title: "Research", icon: FileSearchIcon, body: "Traceable sources, citations, and executive summaries" },
    { title: "Coder", icon: Code2Icon, body: "Repo work, patches, tests, and build verification" },
  ],
  so: [
    { title: "Sheeko", icon: MessageSquareTextIcon, body: "Jawaabo degdeg ah, macne buuxa, iyo wada hadal joogto ah" },
    { title: "Cilmi-baaris", icon: FileSearchIcon, body: "Ilo la raaci karo, xigashooyin, iyo warbixinno kooban" },
    { title: "Coder", icon: Code2Icon, body: "Shaqada repo-ga, sixid koodh, tijaabooyin, iyo hubin dhab ah" },
  ],
} as const;

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
    badge: "AI workspace · chat, research & coder",
    heroA: "Built for",
    heroEm: "the actual work.",
    heroBody:
      "A premium workspace for real assistant work: chat with a model, research with receipts, or code with verification. Tflash keeps work focused, bilingual, and production-ready.",
    ctaPrimary: "Launch workspace",
    ctaSecondary: "See how it works",
    trust: "Made for desktop, tablet and mobile · approval-first workflows",
    previewTitle: "New task",
    previewStatus: "Needs approval",
    previewUser: "Find the likely bug in the payments flow and patch it with a targeted test.",
    previewReply: "I’ll inspect the failure path, isolate the root cause, and prepare a reviewed fix.",
    previewSteps: ["Trace the failing request", "Patch the root cause", "Run a focused verification"],
    previewTool: "coder · app/payments",
    previewToolNote: "Reviewing a local change · waiting for your approval",
    previewApprove: "Approve",
    previewReview: "Review",
    overviewKicker: "Why Tflash",
    overviewTitle: "One calm place for the whole loop.",
    overviewBody:
      "Turn a rough idea into a finished result without bouncing between tabs, documents, and tool UIs. Tflash connects research, code, approvals, and delivery in a single work surface.",
    featureKicker: "Work modes",
    featureTitle: "Chat, research, or code without changing tools.",
    features: [
      {
        title: "Bilingual agent chat",
        body: "The interface and assistant stay fluent in Somali and English, while the work itself stays focused and readable.",
      },
      {
        title: "Model switching, made simple",
        body: "Move between providers and models without breaking the flow. Pick the right model for the right task in seconds.",
      },
      {
        title: "Approval-first execution",
        body: "Every external action is gated, inspectable, and explicit. You approve the action before it happens.",
      },
      {
        title: "Research with traceable sources",
        body: "Capture where a claim came from, what was read, and which evidence actually supports it.",
      },
      {
        title: "Deliverables you can use",
        body: "Turn the result into Markdown, CSV, JSON, DOCX, or PDF without leaving the workspace.",
      },
      {
        title: "Voice and conversation flow",
        body: "Use speech input and listen back to responses when you need to move faster on mobile or in the field.",
      },
      {
        title: "Built for real agent work",
        body: "The product is designed around live task flow: ask, inspect, approve, complete, and export with confidence.",
      },
    ],
    stepsKicker: "How it works",
    stepsTitle: "Three moves, from question to result.",
    steps: [
      {
        title: "Choose the right mode",
        body: "Switch between Chat, Research, and Coder to match the task. Each mode keeps the right context and controls visible.",
      },
      {
        title: "Work with context and approvals",
        body: "Add files, ask for research, or run repo tasks. Every external step waits for your clear approval.",
      },
      {
        title: "Finish and export",
        body: "Keep the result in the conversation, download the output, or continue building the next step without friction.",
      },
    ],
    providersKicker: "Providers",
    providersTitle: "Bring the model you already trust.",
    providersBody:
      "One premium interface, many backends. Use your own keys or the gateway you already rely on, without changing your workflow.",
    providersNote: "Ollama, LM Studio and custom endpoints are reached from the server and must be explicitly allowed in production.",
    securityKicker: "Privacy",
    securityTitle: "Approval is the default, not a feature.",
    securityPoints: [
      {
        title: "Keys stay account-scoped",
        body: "Provider credentials are protected and associated to the signed-in account, so they do not leak across users or sessions.",
      },
      {
        title: "External calls ask first",
        body: "Shell commands, tool calls, and research steps require a fresh approval before they run.",
      },
      {
        title: "Conversations stay owned",
        body: "Workspace history remains tied to account ownership. The product keeps the work in your control.",
      },
    ],
    securityNote:
      "No product can promise perfect security. The project documents real limits, known costs, and approval boundaries clearly in its own README and operational guidance.",
    faqKicker: "Questions",
    faqTitle: "The short answers.",
    faqs: [
      {
        q: "Is Tflash free?",
        a: "Using your own provider key means you pay that provider directly. Tflash itself has no subscription; some gateway models are free and availability depends on the provider.",
      },
      {
        q: "Do I need an account?",
        a: "Yes — sign in with email and password, or continue with Vercel. The two are separate accounts and do not share history.",
      },
      {
        q: "Does Somali work everywhere?",
        a: "The interface and assistant do. Speech recognition and available voices are provided by your browser or device, and support may vary by platform.",
      },
      {
        q: "Where does my data live?",
        a: "Transcripts live in the workflow storage; index data and chat metadata live in Supabase or browser storage depending on your selected sign-in method.",
      },
      {
        q: "Can I use it offline?",
        a: "No. Tflash needs a network connection to reach the selected provider and work with connected tools.",
      },
    ],
    finalKicker: "Ready when you are",
    finalTitle: "Start with a question. Finish with a result.",
    finalBody: "Sign in, choose a model, and experience a calmer AI workspace built for real work.",
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
    badge: "Goob AI · sheeko, cilmi-baaris & coder",
    heroA: "Loo dhisay",
    heroEm: "shaqada dhabta ah.",
    heroBody:
      "Goob shaqo oo AI ah: kula hadal model, baar adigoo haysta ilo la raaci karo, ama qor koodh la hubiyay. Tflash waxay shaqadaada ka dhigtaa mid habaysan, laba-luqadood ah, oo diyaar u ah adeegsi dhab ah.",
    ctaPrimary: "Fur goobta shaqada",
    ctaSecondary: "Arag sida ay u shaqayso",
    trust: "Loogu talagalay desktop, tablet iyo mobile · hawlo oggolaansho leh",
    previewTitle: "Hawl cusub",
    previewStatus: "Oggolaansho ayaa loo baahan yahay",
    previewUser: "Hel qaladka ku jira habka lacag-bixinta oo ku xalli isbeddel leh tijaabo ku habboon.",
    previewReply: "Waxaan raaci doonaa halka qaladku ka dhacay, waxaan ogaanayaa sababta rasmiga ah, waxaanan diyaarinayaa xal la hubiyay.",
    previewSteps: ["Raac codsiga fashilmay", "Xalli sababta asaasiga ah", "Socodsii hubin kooban"],
    previewTool: "coder · app/payments",
    previewToolNote: "Wuxuu eegayaa isbeddel gudaha ah · wuxuu sugayaa oggolaanshahaaga",
    previewApprove: "Oggolow",
    previewReview: "Dib u eeg",
    overviewKicker: "Sababta Tflash",
    overviewTitle: "Hal meel oo deggan oo hawsha oo dhan qabata.",
    overviewBody:
      "U beddel fikrad qabyo ah natiijo dhammaystiran adigoon u kala boodin daaqado, dukumeentiyo, iyo qalab kala duwan. Tflash waxay ku midaysaa baarista, koodhka, oggolaanshaha, iyo dhoofinta hal goob shaqo.",
    featureKicker: "Hababka shaqada",
    featureTitle: "Wada hadal, cilmi-baaris, ama koodh adigoon beddelin qalabka.",
    features: [
      {
        title: "Wada hadal kaaliye laba-luqadood ah",
        body: "Interface-ka iyo kaaliyuhu waxay ku hadlaan Soomaali iyo English, iyadoo shaqadu ay weli tahay mid feker leh oo akhriskeedu fudud yahay.",
      },
      {
        title: "Beddel modelka si fudud",
        body: "U kala beddel bixiyeyaasha iyo modelada adigoon hakin shaqadaada. Dooro model-ka ku habboon hawsha ilbiriqsiyo gudahood.",
      },
      {
        title: "Fulinta ku xiran oggolaansho",
        body: "Tallaabo kasta oo dibadda ah way xaddidan tahay, waa la eegi karaa, waxayna sugtaa oggolaanshahaaga ka hor inta aysan dhicin.",
      },
      {
        title: "Cilmi-baaris leh caddayn la raaci karo",
        body: "Keydi halka sheegashadu ka timid, waxa la akhriyey, iyo caddaynta dhabta ah ee taageeraysa.",
      },
      {
        title: "Natiijooyin aad adeegsan karto",
        body: "U beddel natiijada Markdown, CSV, JSON, DOCX, ama PDF adigoon goobta shaqada ka bixin.",
      },
      {
        title: "Cod iyo socodka wada hadalka",
        body: "Isticmaal cod ku qorista oo dib u dhegeyso jawaabaha markaad u baahan tahay inaad si dhaqso leh ugu shaqayso mobile ama goobta shaqada.",
      },
      {
        title: "Loo dhisay shaqo dhab ah",
        body: "Qalabku wuxuu ku dhisan yahay socodka shaqo ee dhabta ah: weydii, eeg, oggolow, dhammee, oo dhoofi adigoo kalsooni qaba.",
      },
    ],
    stepsKicker: "Sida ay u shaqayso",
    stepsTitle: "Saddex tallaabo, su’aal ilaa natiijo.",
    steps: [
      {
        title: "Dooro habka saxda ah",
        body: "U kala beddel Sheeko, Cilmi-baaris, iyo Coder si aad u waafajiso hawsha. Hab kasta wuxuu muujiyaa xogta iyo xakamaynta ku habboon.",
      },
      {
        title: "La shaqee macne iyo oggolaansho",
        body: "Ku dar faylal, codso cilmi-baaris, ama qabo hawlo repo. Tallaabo kasta oo dibadda ah waxay sugtaa oggolaanshahaaga cad.",
      },
      {
        title: "Dhammee oo dhoofi",
        body: "Ku hay natiijada wada hadalka, soo dejiso faylka, ama sii wad tallaabada xigta si fudud.",
      },
    ],
    providersKicker: "Bixiyeyaasha",
    providersTitle: "Keen modelka aad horey u aaminsanayd.",
    providersBody:
      "Hal interface oo heer sare ah, backends badan. Isticmaal furayaashaada ama gateway-ga aad horey u adeegsan jirtay, adigoon beddelin socodkaaga.",
    providersNote: "Ollama, LM Studio iyo endpoints gaar ah waxaa laga gaaraa server-ka, waana in si cad loo oggolaadaa production-ka.",
    securityKicker: "Asturnaanta",
    securityTitle: "Fasaxgu waa default-ka, ma aha muuqaal.",
    securityPoints: [
      {
        title: "Furayaashu waxay ku xiran yihiin akoonka",
        body: "Aqoonsiga bixiyeyaasha waa la ilaaliyaa waxayna ku xiran yihiin akoonka soo galay, si aysan ugu dhex fidin isticmaaleyaal ama fadhiyo kale.",
      },
      {
        title: "Wicitaannada dibaddu waxay weydiiyaan oggolaansho",
        body: "Amarrada shell, wicitaannada qalabka, iyo tallaabooyinka baaristu waxay u baahan yihiin oggolaansho cusub ka hor fulinta.",
      },
      {
        title: "Wada hadalladu adiga ayay kuu gaar yihiin",
        body: "Taariikhda goobta shaqadu waxay ku xiran tahay lahaanshaha akoonkaaga. Nidaamku wuxuu shaqada ku hayaa gacantaada.",
      },
    ],
    securityNote:
      "Ma jiro badeecad dammaanad qaadi karta amni qumman. Mashruucu wuxuu si cad ugu qeexaa xaddidaadaha dhabta ah, kharashyada la yaqaan, iyo xuduudaha oggolaanshaha README-ka iyo hagidda shaqada.",
    faqKicker: "Su’aalo",
    faqTitle: "Jawaabaha gaaban.",
    faqs: [
      {
        q: "Tflash ma bilaash baa?",
        a: "Haddii aad isticmaasho furahaaga bixiyaha, waxaad si toos ah u bixisaa bixiyahaas. Tflash lafteedu ma laha biil bille ah; qaar ka mid ah modelada gateway waa bilaash, helitaankooduna wuxuu ku xiran yahay bixiyaha.",
      },
      {
        q: "Akoon ma u baahanahay?",
        a: "Haa — ku soo gal email iyo fure sir ah, ama ku sii wad Vercel. Labaduba waa akoonno kala madax bannaan oo aan wadaagin taariikh.",
      },
      {
        q: "Soomaali ma ka shaqaysaa meel kasta?",
        a: "Interface-ka iyo kaaliyuhu haa. Aqoonsiga codka iyo codadka la heli karo waxay ku xiran yihiin browser-kaaga ama qalabkaaga, taageeraduna way ku kala duwanaan kartaa.",
      },
      {
        q: "Xogtaydu xaggee ku kaydsan tahay?",
        a: "Qoraallada wada hadalku waxay ku jiraan kaydka workflow-ga; xogta tusmada iyo metadata-da wada hadalku waxay ku jiraan Supabase ama kaydka browser-ka iyadoo ku xiran habka soo-gelitaankaaga.",
      },
      {
        q: "Internet la'aan ma isticmaali karaa?",
        a: "Maya. Tflash waxay u baahan tahay xiriir internet si ay u gaadho bixiyaha la doortay oo ay ula shaqayso qalabka ku xiran.",
      },
    ],
    finalKicker: "Diyaar markaad tahay",
    finalTitle: "Ku bilow su’aal. Ku dhammee natiijo.",
    finalBody: "Soo gal, dooro model, oo ku shaqee goob AI oo deggan oo loo dhisay shaqada dhabta ah.",
    finalCta: "Fur Tflash",
    footerTagline: "Goob AI laba-luqadood ah oo loogu talagalay wada hadal, cilmi-baaris iyo shaqo dhammaystiran.",
    footerSignIn: "Soo gal",
    footerCreate: "Samee akoon",
    footerDocs: "Dukumeentiyada",
    footerSource: "Koodhka GitHub",
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
      // Storage may be disabled.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = (next: Language) => {
    setLanguage(next);
    try {
      localStorage.setItem("tflash:language", next);
      window.dispatchEvent(new CustomEvent("tflash:language-change", { detail: next }));
    } catch {
      // private browsing
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

function ChatPreview({ language, text }: { readonly language: Language; readonly text: (typeof copy)[Language] }) {
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
      <div className="lp-preview-badge"><BadgeCheckIcon size={14} />{language === "so" ? "Soomaali + English" : "Somali + English"}</div>
    </div>
  );
}

function ModeGrid({ language }: { readonly language: Language }) {
  return (
    <div className="lp-mode-grid" aria-label={language === "so" ? "Hababka adeegga" : "Product modes"}>
      {MODE_TILES[language].map(({ title, icon: Icon, body }) => (
        <article className="lp-mode-card" key={title}>
          <span className="lp-mode-icon"><Icon size={18} /></span>
          <h3>{title}</h3>
          <p>{body}</p>
        </article>
      ))}
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
            <ModeGrid language={language} />
          </div>
          <ChatPreview language={language} text={text} />
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

