import React, { useEffect, useRef, useState } from 'react';
import Brand from '../components/uh/Brand.jsx';
import { AlertIcon, EyeIcon, EyeOffIcon, LockIcon, LoginIcon, UserIcon } from '../components/uh/Icons.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { navigate } from '../router/Router.jsx';

export default function LoginPage() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const firstField = useRef(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  // Accounts are keyed by email address on the API (Identity is configured with
  // RequireUniqueEmail). Someone typing "admin" would otherwise get a flat
  // "Invalid credentials" and no idea why, so say what the field wants.
  const looksLikeEmail = username.includes('@');
  const showEmailHint = username.trim().length > 2 && !looksLikeEmail;

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    // Validated on submit rather than by grinding the button out — a control that
    // greys itself out before you have typed reads as broken rather than helpful.
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await signIn(username.trim(), password);
      navigate('/models');
    } catch (err) {
      setError(
        err?.status === 401
          ? 'That username or password is not correct.'
          : err?.message ?? 'Sign in failed. Please try again.'
      );
      setBusy(false);
    }
  }

  return (
    <div className="uh-auth">
      <div className="uh-auth-card">
        <div className="uh-auth-body">
          <Brand />
          <div className="uh-brand-rule" />

          <h1 className="uh-auth-title">Welcome Back</h1>
          <p className="uh-auth-subtitle">Sign in to your account to continue</p>

          {error && (
            <div className="uh-alert error" role="alert">
              <AlertIcon size={17} style={{ flex: 'none', marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="uh-field">
              <label className="uh-label" htmlFor="uh-username">
                Username
              </label>
              <div className="uh-input-wrap">
                <span className="uh-input-icon">
                  <UserIcon />
                </span>
                <input
                  id="uh-username"
                  ref={firstField}
                  className="uh-input"
                  type="text"
                  autoComplete="username"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                />
              </div>
              {showEmailHint && <p className="uh-hint">Sign in with your email address, for example name@company.com</p>}
            </div>

            <div className="uh-field">
              <label className="uh-label" htmlFor="uh-password">
                Password
              </label>
              <div className="uh-input-wrap">
                <span className="uh-input-icon">
                  <LockIcon />
                </span>
                <input
                  id="uh-password"
                  className="uh-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="uh-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            <div className="uh-forgot-row">
              <button type="button" className="uh-link-gold" onClick={() => navigate('/forgot-password')}>
                Forgot password?
              </button>
            </div>

            <button type="submit" className="uh-btn-primary" disabled={busy}>
              {busy ? (
                <>
                  <span className="uh-spinner" />
                  Signing in…
                </>
              ) : (
                <>
                  <LoginIcon size={19} />
                  Login
                </>
              )}
            </button>
          </form>
        </div>

        <div className="uh-auth-footer">© {new Date().getFullYear()} UH Homes. All rights reserved.</div>
      </div>
    </div>
  );
}
