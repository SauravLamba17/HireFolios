// Privacy notice the candidate reads and accepts on the intake PC screen before any photo is taken.
// The live text is per tenant in the privacy_notices table (Settings → Privacy notice), as templates with
// placeholders; this file holds the starting text (seed only), the placeholders and the renderer. Pure: browser-safe.
//
// The starting text is a DRAFT — TO BE CHECKED BY LEGAL (DPDP Act 2023) before real use; the Hindi text needs a
// native-speaker check. Each consent stores the version the candidate saw; published versions are never edited.

export type NoticeLanguage = "en" | "hi";
export const NOTICE_LANGUAGES: { value: NoticeLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
];

/** One language of a notice: the stored template, or the rendered text the candidate sees. */
export type NoticeText = {
  title: string;
  paragraphs: string[];
  agree: string;
  talentPool: string;
  whatsapp: string;
  continue: string;
  required: string;
};
export type NoticeTexts = Record<NoticeLanguage, NoticeText>;
export const NOTICE_FIELDS = ["title", "agree", "talentPool", "whatsapp", "continue", "required"] as const;

/** Placeholders an admin may use in the text; filled in at intake. */
export const NOTICE_PLACEHOLDERS = {
  company: "the company name (Settings → Company)",
  photoDays: "days a photo is kept (Settings → retention)",
  dataDays: "days the other details are kept",
  contact: "the contact person for data requests and complaints",
} as const;
type Vars = { company: string; photoDays: number; dataDays: number; contact: string };

// Version label of the starting text; consents given before notices lived in the database carry it.
export const DEFAULT_NOTICE_VERSION = "draft-2026-11-10";

export const DEFAULT_NOTICE_TEXTS: NoticeTexts = {
  en: {
    title: "How your information is used",
    paragraphs: [
      "{company}'s HR team is recording these details for your job application: name, mobile number, email, date of birth, city, education, experience, current and expected salary, certifications and skills, a photo of you, and photos of your CV pages.",
      "They are used only to identify you, run your interviews and decide on this application. They stay on our office computer, only our recruitment team can see them, and they are never sold or given to outside companies.",
      "Your photo is deleted after {photoDays} days and all other details after {dataDays} days.",
      "You can ask at the HR desk at any time to see, correct or delete your information, or to withdraw your consent. We do not collect your Aadhaar number or a photo of your Aadhaar card.",
    ],
    agree: "I have read this notice and agree to my details, photo and CV being used for this application.",
    talentPool: "You may contact me about future openings while my profile is kept (talent pool). (Optional)",
    whatsapp: "HR may contact me on WhatsApp about my interviews. (Optional)",
    continue: "I agree, continue",
    required: "Tick the first box to continue.",
  },
  hi: {
    title: "आपकी जानकारी का उपयोग कैसे होगा",
    paragraphs: [
      "{company} की HR टीम आपकी नौकरी की आवेदन प्रक्रिया के लिए यह जानकारी दर्ज कर रही है: नाम, मोबाइल नंबर, ईमेल, जन्म तिथि, शहर, शिक्षा, अनुभव, वर्तमान और अपेक्षित वेतन, सर्टिफ़िकेशन और स्किल्स, आपकी फ़ोटो, और आपके CV के पन्नों की फ़ोटो।",
      "इसका उपयोग केवल आपकी पहचान करने, आपके इंटरव्यू आयोजित करने और इस आवेदन पर निर्णय लेने के लिए होगा। यह जानकारी हमारे ऑफ़िस के कंप्यूटर पर रहती है, केवल हमारी भर्ती टीम इसे देख सकती है, और इसे बेचा या किसी बाहरी कंपनी को नहीं दिया जाता।",
      "आपकी फ़ोटो {photoDays} दिन बाद और बाकी सारी जानकारी {dataDays} दिन बाद हटा दी जाती है।",
      "आप कभी भी अपनी जानकारी देख सकते हैं, उसे ठीक करवा सकते हैं, हटवा सकते हैं, या अपनी सहमति वापस ले सकते हैं। इसके लिए HR डेस्क पर बताएं। हम आधार नंबर या आधार कार्ड की फ़ोटो नहीं लेते।",
    ],
    agree: "मैंने यह सूचना पढ़ ली है और इस आवेदन के लिए अपनी जानकारी, फ़ोटो और CV के उपयोग के लिए सहमत हूँ।",
    talentPool: "जब तक मेरी प्रोफ़ाइल रखी गई है, आगे आने वाली नौकरियों के लिए मुझसे संपर्क किया जा सकता है (टैलेंट पूल)। (वैकल्पिक)",
    whatsapp: "इंटरव्यू से जुड़ी जानकारी के लिए HR मुझसे WhatsApp पर संपर्क कर सकता है। (वैकल्पिक)",
    continue: "सहमत हूँ, आगे बढ़ें",
    required: "आगे बढ़ने के लिए पहले बॉक्स पर टिक करना ज़रूरी है।",
  },
};

/** Sentence offered for a first draft that does not name the contact person yet (admin may edit it). */
export const CONTACT_SENTENCE: Record<NoticeLanguage, string> = {
  en: "For requests or complaints about your data you can also contact {contact}.",
  hi: "अपनी जानकारी से जुड़े अनुरोध या शिकायत के लिए आप {contact} से भी संपर्क कर सकते हैं।",
};

/** "Name, email, phone" for the {contact} placeholder; the HR desk when nobody is named yet. */
export function contactText(lang: NoticeLanguage, c: { name: string | null; email: string | null; phone: string | null }) {
  const parts = [c.name, c.email, c.phone].map((v) => v?.trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : lang === "hi" ? "HR डेस्क" : "the HR desk";
}

const fill = (t: string, v: Vars) => t.replace(/\{(company|photoDays|dataDays|contact)\}/g, (_, k: keyof Vars) => String(v[k]));

/** The text a candidate sees: placeholders filled in. */
export function renderNotice(t: NoticeText, vars: Vars): NoticeText {
  return {
    title: fill(t.title, vars),
    paragraphs: t.paragraphs.map((p) => fill(p, vars)),
    agree: fill(t.agree, vars),
    talentPool: fill(t.talentPool, vars),
    whatsapp: fill(t.whatsapp, vars),
    continue: fill(t.continue, vars),
    required: fill(t.required, vars),
  };
}

/** Problems that block publishing: empty parts, unknown {placeholders}. */
export function noticeProblems(texts: NoticeTexts): string[] {
  const out: string[] = [];
  for (const { value: lang, label } of NOTICE_LANGUAGES) {
    const t = texts[lang];
    if (!t || !t.paragraphs?.some((p) => p.trim())) out.push(`${label}: the notice text is empty.`);
    for (const f of NOTICE_FIELDS) if (!t?.[f]?.trim()) out.push(`${label}: "${f}" is empty.`);
    const all = [t?.title, ...(t?.paragraphs ?? []), ...NOTICE_FIELDS.map((f) => t?.[f])].join(" ");
    for (const m of all.matchAll(/\{([^}]*)\}/g)) if (!(m[1] in NOTICE_PLACEHOLDERS)) out.push(`${label}: unknown placeholder {${m[1]}}.`);
  }
  return out;
}
