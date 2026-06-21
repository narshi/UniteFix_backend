import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import kn from './locales/kn.json';
import { useLanguageStore } from '../stores/languageStore';

const resources = {
  en,
  kn,
};

/**
 * Detect device language safely.
 * expo-localization is a native module — wrap in try/catch so that
 * any version/build mismatch doesn't crash the entire bundle.
 */
function getDeviceLanguage(): string {
  try {
    const { getLocales } = require('expo-localization');
    const locales = getLocales();
    if (locales?.[0]?.languageCode === 'kn') return 'kn';
  } catch (e) {
    console.warn('[i18n] Could not read device locale, defaulting to English:', e);
  }
  return 'en';
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getDeviceLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already safe from XSS
    },
  });

// Setup a listener for the Zustand store to sync i18n language
useLanguageStore.subscribe((state) => {
  if (state.isHydrated && state.language !== i18n.language) {
    i18n.changeLanguage(state.language);
  }
});

// Sync initially if hydrated immediately
const initialState = useLanguageStore.getState();
if (initialState.isHydrated && initialState.language) {
  i18n.changeLanguage(initialState.language);
}

export default i18n;
