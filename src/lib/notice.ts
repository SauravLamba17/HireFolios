// Privacy notice the candidate reads and accepts on the tablet before any photo is taken.
//
// DRAFT — TO BE CHECKED BY LEGAL (DPDP Act 2023) before real use. The Hindi text also needs a
// native-speaker check. Any wording change must bump NOTICE_VERSION: each consent row stores the
// version the candidate saw, and the tablet refuses to save against an outdated version.
export const NOTICE_VERSION = "draft-2026-11-10";

export type NoticeLanguage = "en" | "hi";
export const NOTICE_LANGUAGES: { value: NoticeLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
];

type NoticeInput = { company: string; photoDays: number; dataDays: number };

export type NoticeText = {
  title: string;
  paragraphs: string[];
  agree: string;
  talentPool: string;
  whatsapp: string;
  continue: string;
  required: string;
};

export function noticeText(lang: NoticeLanguage, { company, photoDays, dataDays }: NoticeInput): NoticeText {
  if (lang === "hi") {
    return {
      title: "आपकी जानकारी का उपयोग कैसे होगा",
      paragraphs: [
        `${company} की HR टीम आपकी नौकरी की आवेदन प्रक्रिया के लिए यह जानकारी दर्ज कर रही है: नाम, मोबाइल नंबर, ईमेल, जन्म तिथि, शहर, शिक्षा, अनुभव, वर्तमान और अपेक्षित वेतन, सर्टिफ़िकेशन और स्किल्स, आपकी फ़ोटो, और आपके CV के पन्नों की फ़ोटो।`,
        "इसका उपयोग केवल आपकी पहचान करने, आपके इंटरव्यू आयोजित करने और इस आवेदन पर निर्णय लेने के लिए होगा। यह जानकारी हमारे ऑफ़िस के कंप्यूटर पर रहती है, केवल हमारी भर्ती टीम इसे देख सकती है, और इसे बेचा या किसी बाहरी कंपनी को नहीं दिया जाता।",
        `आपकी फ़ोटो ${photoDays} दिन बाद और बाकी सारी जानकारी ${dataDays} दिन बाद हटा दी जाती है।`,
        "आप कभी भी अपनी जानकारी देख सकते हैं, उसे ठीक करवा सकते हैं, हटवा सकते हैं, या अपनी सहमति वापस ले सकते हैं। इसके लिए HR डेस्क पर बताएं। हम आधार नंबर या आधार कार्ड की फ़ोटो नहीं लेते।",
      ],
      agree: "मैंने यह सूचना पढ़ ली है और इस आवेदन के लिए अपनी जानकारी, फ़ोटो और CV के उपयोग के लिए सहमत हूँ।",
      talentPool: "जब तक मेरी प्रोफ़ाइल रखी गई है, आगे आने वाली नौकरियों के लिए मुझसे संपर्क किया जा सकता है (टैलेंट पूल)। (वैकल्पिक)",
      whatsapp: "इंटरव्यू से जुड़ी जानकारी के लिए HR मुझसे WhatsApp पर संपर्क कर सकता है। (वैकल्पिक)",
      continue: "सहमत हूँ, आगे बढ़ें",
      required: "आगे बढ़ने के लिए पहले बॉक्स पर टिक करना ज़रूरी है।",
    };
  }
  return {
    title: "How your information is used",
    paragraphs: [
      `${company}'s HR team is recording these details for your job application: name, mobile number, email, date of birth, city, education, experience, current and expected salary, certifications and skills, a photo of you, and photos of your CV pages.`,
      "They are used only to identify you, run your interviews and decide on this application. They stay on our office computer, only our recruitment team can see them, and they are never sold or given to outside companies.",
      `Your photo is deleted after ${photoDays} days and all other details after ${dataDays} days.`,
      "You can ask at the HR desk at any time to see, correct or delete your information, or to withdraw your consent. We do not collect your Aadhaar number or a photo of your Aadhaar card.",
    ],
    agree: "I have read this notice and agree to my details, photo and CV being used for this application.",
    talentPool: "You may contact me about future openings while my profile is kept (talent pool). (Optional)",
    whatsapp: "HR may contact me on WhatsApp about my interviews. (Optional)",
    continue: "I agree, continue",
    required: "Tick the first box to continue.",
  };
}
