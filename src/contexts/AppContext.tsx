import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, clearAuthToken } from '../lib/api';
import type { Book, CartItem, LanguageCode, ThemeMode, UserProfile } from '../shared/types';
import { t as translateKey } from '../i18n/translations';

interface AppContextValue {
  user: UserProfile | null;
  authLoading: boolean;
  language: LanguageCode;
  theme: ThemeMode;
  cartItems: CartItem[];
  wishlistIds: Set<string>;
  unreadNotifications: number;
  setLanguage: (lang: LanguageCode) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  refreshSession: () => Promise<void>;
  refreshCommerceState: () => Promise<void>;
  logout: () => Promise<void>;
  addToCart: (bookId: string) => Promise<void>;
  removeFromCart: (bookId: string) => Promise<void>;
  toggleWishlist: (bookId: string) => Promise<boolean>;
  t: (key: string) => string;
}

const AppContext = createContext<AppContextValue | null>(null);

function getInitialLanguage(): LanguageCode {
  try {
    const saved = localStorage.getItem('ksdl_ui_lang');
    if (saved === 'so' || saved === 'en' || saved === 'ar') return saved;
  } catch {
    // ignore
  }
  return 'so';
}

function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem('ksdl_ui_theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore
  }
  return 'light';
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [language, setLanguageState] = useState<LanguageCode>(getInitialLanguage);
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  // Sync HTML lang, dir, and dark class
  useEffect(() => {
    const html = document.documentElement;
    html.lang = language;
    html.dir = language === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('ksdl_ui_lang', language);
    } catch {
      // ignore
    }
  }, [language]);

  useEffect(() => {
    const html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    try {
      localStorage.setItem('ksdl_ui_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const refreshCommerceState = useCallback(async () => {
    try {
      const [cartRes, wishRes, notifRes] = await Promise.all([
        apiFetch<{ items: CartItem[] }>('/api/cart'),
        apiFetch<{ items: Book[] }>('/api/account/wishlist'),
        apiFetch<{ items: Array<{ isRead: boolean }> }>('/api/account/notifications'),
      ]);
      setCartItems(cartRes.items);
      setWishlistIds(new Set(wishRes.items.map((b) => b.id)));
      setUnreadNotifications(notifRes.items.filter((n) => !n.isRead).length);
    } catch {
      setCartItems([]);
      setWishlistIds(new Set());
      setUnreadNotifications(0);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const res = await apiFetch<{ user: UserProfile | null }>('/api/auth/me');
      setUser(res.user);
      if (res.user) {
        await refreshCommerceState();
      } else {
        clearAuthToken();
        setCartItems([]);
        setWishlistIds(new Set());
        setUnreadNotifications(0);
      }
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, [refreshCommerceState]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const setLanguage = useCallback(
    (lang: LanguageCode) => {
      setLanguageState(lang);
      if (user) {
        void apiFetch('/api/account/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: user.fullName || 'Reader',
            preferredLanguage: lang,
            preferredTheme: theme,
            emailNotifications: user.emailNotifications,
          }),
        }).catch(() => {});
      }
    },
    [user, theme]
  );

  const setTheme = useCallback(
    (nextTheme: ThemeMode) => {
      setThemeState(nextTheme);
      if (user) {
        void apiFetch('/api/account/profile', {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: user.fullName || 'Reader',
            preferredLanguage: language,
            preferredTheme: nextTheme,
            emailNotifications: user.emailNotifications,
          }),
        }).catch(() => {});
      }
    },
    [user, language]
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      clearAuthToken();
      setUser(null);
      setCartItems([]);
      setWishlistIds(new Set());
      setUnreadNotifications(0);
    }
  }, []);

  const addToCart = useCallback(async (bookId: string) => {
    const res = await apiFetch<{ items: CartItem[] }>(`/api/cart/${bookId}`, { method: 'POST' });
    setCartItems(res.items);
  }, []);

  const removeFromCart = useCallback(async (bookId: string) => {
    const res = await apiFetch<{ items: CartItem[] }>(`/api/cart/${bookId}`, { method: 'DELETE' });
    setCartItems(res.items);
  }, []);

  const toggleWishlist = useCallback(
    async (bookId: string) => {
      const exists = wishlistIds.has(bookId);
      const res = await apiFetch<{ items: Book[] }>(`/api/account/wishlist/${bookId}`, {
        method: exists ? 'DELETE' : 'POST',
      });
      setWishlistIds(new Set(res.items.map((b) => b.id)));
      return !exists;
    },
    [wishlistIds]
  );

  const t = useCallback((key: string) => translateKey(language, key), [language]);

  return (
    <AppContext.Provider
      value={{
        user,
        authLoading,
        language,
        theme,
        cartItems,
        wishlistIds,
        unreadNotifications,
        setLanguage,
        setTheme,
        toggleTheme,
        refreshSession,
        refreshCommerceState,
        logout,
        addToCart,
        removeFromCart,
        toggleWishlist,
        t,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
