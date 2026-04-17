import React, { createContext, useContext, useEffect } from 'react';
import { translations } from './translations';

const I18nContext = createContext();

export function I18nProvider({ children, language }) {
  const t = (key) => {
    return translations[language]?.[key] || translations['en']?.[key] || key;
  };

  useEffect(() => {
    document.documentElement.dir = language === 'ckb' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    // Fallback if used outside provider (rare)
    return {
      language: 'en',
      t: (key) => translations['en']?.[key] || key
    };
  }
  return context;
}
