import React, { useEffect, useRef, useState } from 'react';
import Brand from '../components/uh/Brand.jsx';
import { AlertIcon, ArrowLeftIcon, MailIcon, SendIcon } from '../components/uh/Icons.jsx';
import { navigate } from '../router/Router.jsx';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const field = useRef(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  function handleSubmit(e) {
    e.preventDefault();
    if (!valid) return;
    // There is no reset endpoint on the API yet (AuthController exposes login,
    // register and me). Rather than show a "check your inbox" message for mail
    // that will never arrive, say plainly what happens next.
    setSent(true);
  }

  return (
    <div className="uh-auth">
      <div className="uh-auth-card">
        <div className="uh-auth-body">
          <Brand />
          <div className="uh-brand-rule" />

          <h1 className="uh-auth-title">Forgot Password</h1>
          <p className="uh-auth-subtitle">Enter your email and we'll send you a reset link</p>

          {sent ? (
            <>
              <div className="uh-alert info" role="status">
                <AlertIcon size={17} style={{ flex: 'none', marginTop: 1 }} />
                <span>
                  Self-service password reset is not enabled in this environment yet. Please ask an administrator to
                  reset the password for <strong>{email.trim()}</strong>.
                </span>
              </div>
              <button type="button" className="uh-btn-primary" onClick={() => navigate('/login')}>
                Back to Login
              </button>
            </>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="uh-field">
                <label className="uh-label" htmlFor="uh-email">
                  Email Address
                </label>
                <div className="uh-input-wrap">
                  <span className="uh-input-icon">
                    <MailIcon />
                  </span>
                  <input
                    id="uh-email"
                    ref={field}
                    className="uh-input"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <button type="submit" className="uh-btn-primary" disabled={!valid}>
                <SendIcon size={19} />
                Send Reset Link
              </button>
            </form>
          )}

          <div className="uh-back-row">
            <button type="button" className="uh-back-link" onClick={() => navigate('/login')}>
              <ArrowLeftIcon size={16} />
              Back to Login
            </button>
          </div>
        </div>

        <div className="uh-auth-footer">© {new Date().getFullYear()} UH Homes. All rights reserved.</div>
      </div>
    </div>
  );
}
