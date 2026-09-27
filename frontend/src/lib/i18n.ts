/**
 * Minimal i18n: English + Russian + Uzbek for shell chrome.
 * Game content stays English-first; this covers navigation and core
 * actions. Dictionaries are intentionally small and fully translated —
 * no half-translated keys.
 */
import { useSettings } from '../stores/settings.js';

export type Lang = 'en' | 'ru' | 'uz';

const STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    play: 'Play', bots: 'Bots', puzzles: 'Puzzles', training: 'Training',
    ranks: 'Ranks', watch: 'Watch', friends: 'Friends', clubs: 'Clubs',
    cups: 'Cups', premium: 'Premium', settings: 'Settings', login: 'Login',
    logout: 'Logout', search: 'Search', inbox: 'Inbox',
  },
  ru: {
    play: 'Играть', bots: 'Боты', puzzles: 'Задачи', training: 'Тренировка',
    ranks: 'Рейтинг', watch: 'Смотреть', friends: 'Друзья', clubs: 'Клубы',
    cups: 'Турниры', premium: 'Премиум', settings: 'Настройки', login: 'Войти',
    logout: 'Выйти', search: 'Поиск', inbox: 'Входящие',
  },
  uz: {
    play: 'O‘ynash', bots: 'Botlar', puzzles: 'Jumboqlar', training: 'Mashq',
    ranks: 'Reyting', watch: 'Tomosha', friends: 'Do‘stlar', clubs: 'Klublar',
    cups: 'Turnirlar', premium: 'Premium', settings: 'Sozlamalar', login: 'Kirish',
    logout: 'Chiqish', search: 'Qidiruv', inbox: 'Xatlar',
  },
};

export function useLang(): Lang {
  return useSettings((s) => s.language);
}

export function useT(): (key: string) => string {
  const lang = useLang();
  return (key: string) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
}
