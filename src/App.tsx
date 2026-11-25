import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppProvider } from './contexts/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';

const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const CatalogPage = lazy(() => import('./pages/CatalogPage').then((m) => ({ default: m.CatalogPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const CategoryDetailPage = lazy(() => import('./pages/CategoriesPage').then((m) => ({ default: m.CategoryDetailPage })));
const BookDetailPage = lazy(() => import('./pages/BookDetailPage').then((m) => ({ default: m.BookDetailPage })));
const LoginPage = lazy(() => import('./pages/AuthPages').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/AuthPages').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('./pages/AuthPages').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/AuthPages').then((m) => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import('./pages/AuthPages').then((m) => ({ default: m.VerifyEmailPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const ReaderPage = lazy(() => import('./pages/ReaderPage').then((m) => ({ default: m.ReaderPage })));
const CartPage = lazy(() => import('./pages/CommercePages').then((m) => ({ default: m.CartPage })));
const CheckoutPage = lazy(() => import('./pages/CommercePages').then((m) => ({ default: m.CheckoutPage })));
const CheckoutResultPage = lazy(() => import('./pages/CommercePages').then((m) => ({ default: m.CheckoutResultPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const AdminLoginPage = lazy(() => import('./pages/AuthPages').then((m) => ({ default: m.AdminLoginPage })));
const AboutPage = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.AboutPage })));
const ContactPage = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.ContactPage })));
const PrivacyPage = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.TermsPage })));
const RefundPolicyPage = lazy(() => import('./pages/InfoPages').then((m) => ({ default: m.RefundPolicyPage })));

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <BrowserRouter>
          <Layout>
            <Suspense fallback={<div className="max-w-7xl mx-auto px-4 py-16 text-sm text-slate-500">Loading...</div>}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/catalog" element={<CatalogPage />} />
                <Route path="/categories" element={<CategoriesPage />} />
                <Route path="/categories/:slug" element={<CategoryDetailPage />} />
                <Route path="/books/:slug" element={<BookDetailPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/account/:tab" element={<AccountPage />} />
                <Route path="/reader/:bookId" element={<ReaderPage />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/checkout" element={<CheckoutPage />} />
                <Route path="/checkout/result" element={<CheckoutResultPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/admin/:tab" element={<AdminPage />} />
                <Route path="/admin-login" element={<AdminLoginPage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/refund-policy" element={<RefundPolicyPage />} />
              </Routes>
            </Suspense>
          </Layout>
        </BrowserRouter>
      </AppProvider>
    </ErrorBoundary>
  );
}
