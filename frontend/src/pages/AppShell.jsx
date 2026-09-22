import React from 'react';
import { BrandMark } from '../components/uh/Brand.jsx';
import { CubeIcon, SlidersIcon } from '../components/uh/Icons.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { Link, navigate } from '../router/Router.jsx';

function initials(name, email) {
  const source = (name || email || '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || source[0].toUpperCase();
}

export default function AppShell({ children }) {
  const { user, roles, can, signOut } = useAuth();

  return (
    <div className="uh-app">
      <header className="uh-nav">
        <div className="uh-brand" style={{ gap: 9 }}>
          <BrandMark size={22} />
          <span className="uh-brand-name">UH HOMES</span>
        </div>

        <nav className="uh-nav-links">
          {/* Module 1 is a production tool: only roles that can upload and capture
              see it at all, which keeps the navigation honest about what a
              Customer account can actually do. */}
          {can.manageModels && (
            <Link to="/models" className="uh-nav-link">
              <CubeIcon size={17} />
              Models &amp; Captures
            </Link>
          )}
          {can.configure && (
            <Link to="/configurator" className="uh-nav-link">
              <SlidersIcon size={17} />
              Image Configurator
            </Link>
          )}
        </nav>

        <div className="uh-nav-spacer" />

        <div className="uh-user">
          <div className="uh-avatar">{initials(user?.displayName, user?.email)}</div>
          <div className="uh-user-meta">
            <div className="uh-user-name">{user?.displayName || user?.email}</div>
            <div className="uh-user-role">{roles.join(', ') || 'No role'}</div>
          </div>
          <button
            className="uh-signout"
            onClick={() => {
              signOut();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="uh-main">{children}</main>
    </div>
  );
}
