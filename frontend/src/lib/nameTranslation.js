export const nameTranslations = {
  // Courses
  "Database Systems": "سیستەمەکانی داتابەیس",
  "Data Structure and Algorithms": "پێکهاتەی دراوە و ئەلگۆریتمەکان",
  "Computer Networks": "تۆڕەکانی کۆمپیوتەر",
  "Engineering Analysis": "شیکاری ئەندازیاری",
  "Software Requirement and Analysis": "پێداویستی و شیکاریی نەرمەکاڵا",
  
  // Professors
  "Mr. Halgurd Rasul": "م. هەڵگورد رەسوڵ",
  "Dr. Saman Mohammad": "د. سامان محەمەد",
  "Mr. Jafar Majidpoor": "م. جەعفەر مەجیدپوور",
  "Mr. Awder Sardar": "م. ئاودێر سەردار",
  "Mrs. Sakar Omar": "م. ساکار عومەر",
  "Dr. Ahmed Hassan": "د. ئەحمەد حەسەن",
  
  // Students
  "Redeen Sirwan": "ڕێدین سیروان",
  "Rebin Hussain": "ڕێبین حسێن",
  "Drwd Samal": "دروود ساماڵ",
  "Arsh Khasraw": "ئارش خەسرەو",
  "Abdulla Sleman": "عەبدوڵڵا سلێمان",
};

export function tName(name, lang) {
  if (!name) return name;
  if (lang !== 'ckb') return name;
  return nameTranslations[name] || name;
}
