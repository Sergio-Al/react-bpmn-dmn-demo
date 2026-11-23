import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';

export const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, es: { translation: es } },
    supportedLngs: LANGUAGES,
    nonExplicitSupportedLngs: true, // es-BO, es-419… → es
    load: 'languageOnly',
    fallbackLng: 'en',
    interpolation: { escapeValue: false }, // React escapes already
    // A choice made with the header switch wins; otherwise follow the browser.
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: 'lang', caches: ['localStorage'] },
    returnNull: false,
  });

const syncDocument = (lng: string) => {
  document.documentElement.lang = lng;
  document.title = i18n.t('app.title');
};
syncDocument(i18n.resolvedLanguage ?? 'en');
i18n.on('languageChanged', () => syncDocument(i18n.resolvedLanguage ?? 'en'));

export const currentLanguage = (): Language => (i18n.resolvedLanguage === 'es' ? 'es' : 'en');

/** Display name for a BPMN element; the process files stay in English. */
export function bpmnName(name: string): string {
  const names = i18n.t('bpmnNames', { returnObjects: true }) as Record<string, string>;
  return names?.[name] ?? name;
}

/** bpmn-js `translate` service, for palette and context-pad tooltips. */
export function bpmnTranslateModule(lng: Language) {
  const table = (i18n.getResource(lng, 'translation', 'bpmnUi') ?? {}) as Record<string, string>;
  const translate = (template: string, replacements: Record<string, string> = {}) =>
    (table[template] ?? template).replace(/{([^}]+)}/g, (_, key: string) => replacements[key] ?? `{${key}}`);
  return { translate: ['value', translate] };
}

export default i18n;
