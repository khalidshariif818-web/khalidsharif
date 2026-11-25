import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, setAuthToken } from '../lib/api';
import { useApp } from '../contexts/AppContext';
import { SeoHead } from '../components/SeoHead';
import type { UserProfile } from '../shared/types';

export const LoginPage: React.FC = () => {
  const { refreshSession, t } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const explicitNext = searchParams.get('next');
  const nextPath = explicitNext || '/account';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ user: UserProfile; sessionToken?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (res.sessionToken) {
        setAuthToken(res.sessionToken);
      }
      await refreshSession();
      const isAdmin = res.user.roles.includes('admin') || res.user.roles.includes('super_admin');
      navigate(!explicitNext && isAdmin ? '/admin' : nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SeoHead title={`${t('loginTitle')} – ${t('brandName')}`} description={t('loginTitle')} noIndex />
      <div className="max-w-md mx-auto px-2.5 sm:px-6 py-6 sm:py-10">
        <div className="p-5 sm:p-8 rounded-xl bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 space-y-5 sm:space-y-6 shadow-sm">
          <h1 className="text-2xl sm:text-3xl font-semibold text-[#02598B] dark:text-sky-400">
            {t('loginTitle')}
          </h1>
          {error && (
            <div role="alert" className="p-3 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-sm font-medium">
                {t('emailLabel')}
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="login-password" className="block text-sm font-medium">
                  {t('passwordLabel')}
                </label>
                <Link to="/forgot-password" className="text-xs text-[#0376B8] dark:text-sky-400 hover:underline py-1">
                  {t('forgotLink')}
                </Link>
              </div>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium rounded bg-[#0376B8] hover:bg-[#02598B] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 disabled:opacity-50"
            >
              {loading ? t('loading') : t('signInBtn')}
            </button>
          </form>
          <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
            {t('noAccountPrompt')}{' '}
            <Link to="/register" className="text-[#0376B8] dark:text-sky-400 font-medium hover:underline">
              {t('registerBtn')}
            </Link>
          </p>
        </div>
      </div>
    </>
  );
};

export const RegisterPage: React.FC = () => {
  const { language, refreshSession, t } = useApp();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationEmailSent, setVerificationEmailSent] = useState(true);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{
        user?: UserProfile;
        sessionToken?: string;
        verificationRequired?: boolean;
        emailDelivery?: { sent: boolean };
      }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, password, preferredLanguage: language }),
      });
      if (res.verificationRequired) {
        setVerificationEmailSent(Boolean(res.emailDelivery?.sent));
        setVerificationPending(true);
        return;
      }
      if (res.sessionToken) {
        setAuthToken(res.sessionToken);
      }
      await refreshSession();
      navigate('/account');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const resendVerification = async () => {
    setResending(true);
    setResendMessage(null);
    try {
      await apiFetch('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResendMessage('If this account still needs verification, a new link has been sent. Check your inbox and spam folder.');
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : 'Could not resend the verification email. Please try again later.');
    } finally {
      setResending(false);
    }
  };

  return (
    <>
      <SeoHead title={`${t('registerTitle')} – ${t('brandName')}`} description={t('registerTitle')} noIndex />
      <div className="max-w-md mx-auto px-2.5 sm:px-6 py-6 sm:py-10">
        <div className="p-5 sm:p-8 rounded-xl bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 space-y-5 sm:space-y-6 shadow-sm">
          <h1 className="text-2xl sm:text-3xl font-semibold text-[#02598B] dark:text-sky-400">
            {t('registerTitle')}
          </h1>
          {verificationPending ? (
            <div className="space-y-4" role="status">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Account-ka waa la sameeyay. Fur email-ka <strong>{email}</strong> oo guji linkiga xaqiijinta si aad u gasho.
                Ka fiiri Spam/Junk haddii uusan Inbox-ka ku jirin.
              </p>
              {!verificationEmailSent && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Email-ku hadda ma bixin. Adeegga email-ka ayaan weli si buuxda loo dejin; isku day dib-u-dirista mar dambe.
                </p>
              )}
              {resendMessage && <p className="text-sm text-slate-600 dark:text-slate-300">{resendMessage}</p>}
              <button
                type="button"
                onClick={() => void resendVerification()}
                disabled={resending}
                className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium rounded border border-[#0376B8] text-[#0376B8] dark:text-sky-400 disabled:opacity-50"
              >
                {resending ? t('loading') : 'Dib u dir linkiga xaqiijinta'}
              </button>
              <p className="text-sm text-center">
                <Link to="/login" className="text-[#0376B8] dark:text-sky-400 font-medium hover:underline">Ku noqo gelitaanka</Link>
              </p>
            </div>
          ) : <>
          {error && (
            <div role="alert" className="p-3 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="reg-name" className="block text-sm font-medium">
                {t('fullNameLabel')}
              </label>
              <input
                id="reg-name"
                type="text"
                required
                minLength={2}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="reg-email" className="block text-sm font-medium">
                {t('emailLabel')}
              </label>
              <input
                id="reg-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="reg-password" className="block text-sm font-medium">
                {t('passwordLabel')}
              </label>
              <input
                id="reg-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium rounded bg-[#0376B8] hover:bg-[#02598B] dark:bg-sky-500 dark:hover:bg-sky-400 text-white dark:text-slate-950 disabled:opacity-50"
            >
              {loading ? t('loading') : t('registerBtn')}
            </button>
          </form>
          <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
            {t('haveAccountPrompt')}{' '}
            <Link to="/login" className="text-[#0376B8] dark:text-sky-400 font-medium hover:underline">
              {t('signInBtn')}
            </Link>
          </p>
          </>}
        </div>
      </div>
    </>
  );
};

export const ForgotPasswordPage: React.FC = () => {
  const { t } = useApp();
  const [email, setEmail] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMsg(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ emailSent: boolean; emailStatus: string; reason?: string; message?: string }>(
        '/api/auth/forgot-password',
        { method: 'POST', body: JSON.stringify({ email }) }
      );
      if (res.emailSent) {
        setStatusMsg('Password reset instructions have been sent to your email.');
      } else {
        setStatusMsg(
          res.message ||
            'Password reset emails are currently unavailable. Please contact support for assistance.'
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SeoHead title={`${t('forgotTitle')} – ${t('brandName')}`} description={t('forgotTitle')} noIndex />
      <div className="max-w-md mx-auto px-2.5 sm:px-6 py-6 sm:py-10">
        <div className="p-5 sm:p-8 rounded-xl bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 space-y-5 sm:space-y-6 shadow-sm">
          <h1 className="text-2xl sm:text-3xl font-semibold text-[#02598B] dark:text-sky-400">{t('forgotTitle')}</h1>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {statusMsg && (
            <div className="p-3 rounded bg-[#F3F0E6] dark:bg-slate-800 border border-[#E5E0CE] dark:border-slate-700 text-sm text-slate-700 dark:text-slate-200">
              {statusMsg}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="forgot-email" className="block text-sm font-medium">
                {t('emailLabel')}
              </label>
              <input
                id="forgot-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium rounded bg-[#0376B8] hover:bg-[#02598B] text-white dark:bg-sky-500 dark:text-slate-950"
            >
              {loading ? t('loading') : t('forgotTitle')}
            </button>
          </form>
        </div>
      </div>
    </>
  );
};

export const ResetPasswordPage: React.FC = () => {
  const { t } = useApp();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      });
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SeoHead title={`${t('resetTitle')} – ${t('brandName')}`} description={t('resetTitle')} noIndex />
      <div className="max-w-md mx-auto px-2.5 sm:px-6 py-6 sm:py-10">
        <div className="p-5 sm:p-8 rounded-xl bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 space-y-5 sm:space-y-6 shadow-sm">
          <h1 className="text-2xl sm:text-3xl font-semibold text-[#02598B] dark:text-sky-400">{t('resetTitle')}</h1>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('passwordLabel')}
              className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
            />
            <button
              type="submit"
              disabled={loading || !token}
              className="w-full min-h-[44px] py-2.5 px-4 text-sm font-medium rounded bg-[#0376B8] hover:bg-[#02598B] text-white dark:bg-sky-500 dark:text-slate-950"
            >
              {t('saveChanges')}
            </button>
          </form>
        </div>
      </div>
    </>
  );
};

export const VerifyEmailPage: React.FC = () => {
  const { t } = useApp();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'verifying' | 'ok' | 'error'>('verifying');
  const token = searchParams.get('token') || '';

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    void apiFetch('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <div className="max-w-md mx-auto px-2.5 sm:px-6 py-6 sm:py-10 text-center space-y-4">
      <div className="p-5 sm:p-8 rounded-xl bg-white dark:bg-slate-900 border border-[#D8D1BE] dark:border-slate-800 shadow-sm">
        {status === 'verifying' && <p>{t('verifyingEmailMsg')}</p>}
        {status === 'ok' && <p className="text-emerald-700 dark:text-emerald-400">{t('verifiedEmailMsg')}</p>}
        {status === 'error' && <p className="text-red-600">{t('invalidVerifyTokenMsg')}</p>}
        <Link to="/account" className="inline-block mt-4 text-sm text-[#0376B8] dark:text-sky-400 underline">
          {t('continueAccountLink')}
        </Link>
      </div>
    </div>
  );
};

export const AdminLoginPage: React.FC = () => {
  const { user, refreshSession, t } = useApp();
  const navigate = useNavigate();

  const [checkingStatus, setCheckingStatus] = useState(true);
  const [hasAdmin, setHasAdmin] = useState(true);
  const [requiresToken, setRequiresToken] = useState(false);

  const [fullName, setFullName] = useState('Library Admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isAlreadyAdmin = Boolean(user?.roles.includes('admin') || user?.roles.includes('super_admin'));

  useEffect(() => {
    if (isAlreadyAdmin) {
      navigate('/admin', { replace: true });
    }
  }, [isAlreadyAdmin, navigate]);

  useEffect(() => {
    let active = true;
    void apiFetch<{ hasAdmin: boolean; requiresBootstrapToken: boolean }>('/api/admin/access-status')
      .then((res) => {
        if (active) {
          setHasAdmin(res.hasAdmin);
          setRequiresToken(res.requiresBootstrapToken);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setCheckingStatus(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const endpoint = hasAdmin ? '/api/admin/login' : '/api/admin/setup-first-admin';
      const body = hasAdmin
        ? { email, password }
        : {
            email,
            password,
            fullName: fullName.trim() || 'Library Admin',
            ...(requiresToken ? { bootstrapToken } : {}),
          };

      const res = await apiFetch<{ user: UserProfile; sessionToken?: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (res.sessionToken) {
        setAuthToken(res.sessionToken);
      }
      await refreshSession();
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SeoHead
        title={`${hasAdmin ? t('adminLoginTitle') : t('adminSetupTitle')} – ${t('brandName')}`}
        description={t('adminLoginTitle')}
        noIndex
      />
      <div className="max-w-md mx-auto px-3 sm:px-6 py-8 sm:py-12">
        <div className="p-5 sm:p-8 rounded-xl bg-white dark:bg-slate-900 border border-[#D5CEB8] dark:border-slate-800 space-y-5 shadow-xs">
          <div className="space-y-1.5 border-b border-[#E5E0CE] dark:border-slate-800 pb-4">
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-[#02598B] dark:text-sky-400">
              {checkingStatus ? t('loading') : hasAdmin ? t('adminLoginTitle') : t('adminSetupTitle')}
            </h1>
            {!checkingStatus && (
              <p className="text-xs sm:text-sm text-[#666155] dark:text-slate-400">
                {hasAdmin ? t('adminLoginSubtitle') : t('adminSetupSubtitle')}
              </p>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          {!checkingStatus && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {!hasAdmin && (
                <div className="space-y-1.5">
                  <label htmlFor="admin-fullname" className="block text-sm font-medium">
                    {t('fullNameLabel')}
                  </label>
                  <input
                    id="admin-fullname"
                    type="text"
                    required
                    minLength={2}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="admin-email" className="block text-sm font-medium">
                  {t('adminEmailLabel')}
                </label>
                <input
                  id="admin-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="admin-password" className="block text-sm font-medium">
                  {t('passwordLabel')}
                </label>
                <input
                  id="admin-password"
                  type="password"
                  required
                  minLength={hasAdmin ? 1 : 8}
                  autoComplete={hasAdmin ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
                />
              </div>

              {!hasAdmin && requiresToken && (
                <div className="space-y-1.5">
                  <label htmlFor="admin-bootstrap-token" className="block text-sm font-medium">
                    {t('adminBootstrapTokenLabel')}
                  </label>
                  <input
                    id="admin-bootstrap-token"
                    type="password"
                    required
                    value={bootstrapToken}
                    onChange={(e) => setBootstrapToken(e.target.value)}
                    className="w-full min-h-[42px] px-3.5 py-2 text-sm rounded border border-[#D4CEB8] dark:border-slate-700 bg-white dark:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[#0376B8]"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] py-2.5 px-4 text-sm font-semibold rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white disabled:opacity-50 transition-colors"
              >
                {submitting ? t('loading') : hasAdmin ? t('adminSignInBtn') : t('adminSetupBtn')}
              </button>
            </form>
          )}

          <div className="text-center pt-1">
            <Link to="/" className="text-xs text-[#666155] dark:text-slate-400 hover:underline">
              {t('adminBackToSite')}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

