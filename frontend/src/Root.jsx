import React, { useEffect, useMemo } from 'react';
import App from './App.jsx';
import AppShell from './pages/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ModelsPage from './pages/models/ModelsPage.jsx';
import AddModelPage from './pages/models/AddModelPage.jsx';
import ModelCapturesPage from './pages/models/ModelCapturesPage.jsx';
import ConfigureListPage from './pages/configure/ConfigureListPage.jsx';
import ImageConfiguratorPage from './pages/configure/ImageConfiguratorPage.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { RouterProvider, Routes, navigate, useRoute } from './router/Router.jsx';
import { Brand } from './components/uh/Brand.jsx';
import { Empty } from './components/uh/Ui.jsx';

const PUBLIC_PATHS = ['/login', '/forgot-password'];

function Splash() {
  return (
    <div className="uh-auth">
      <div className="uh-auth-card">
        <div className="uh-auth-body" style={{ textAlign: 'center' }}>
          <Brand />
          <div className="uh-brand-rule" />
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
            <span className="uh-spinner light" />
          </div>
          <p className="uh-auth-subtitle" style={{ margin: 0 }}>
            Restoring your session…
          </p>
        </div>
      </div>
    </div>
  );
}

/** Shown when a signed-in user reaches a page their role cannot use. */
function NoAccess({ children }) {
  return (
    <div className="uh-page">
      <Empty title="You don't have access to this area">{children}</Empty>
    </div>
  );
}

function Shell() {
  const { isAuthenticated, checking, can } = useAuth();
  const { path } = useRoute();

  const isPublic = PUBLIC_PATHS.includes(path);

  // The landing route depends on what the account is for: an Artist starts in the
  // capture tool, a Customer in the configurator.
  const home = can.manageModels ? '/models' : '/configurator';

  useEffect(() => {
    if (checking) return;
    if (!isAuthenticated && !isPublic) navigate('/login', { replace: true });
    else if (isAuthenticated && (isPublic || path === '/')) navigate(home, { replace: true });
  }, [checking, isAuthenticated, isPublic, path, home]);

  const routes = useMemo(
    () => [
      { path: '/models', render: () => (can.manageModels ? <ModelsPage /> : <NoAccess>Models and captures are managed by the Artist and Admin roles.</NoAccess>) },
      { path: '/models/add', render: () => (can.manageModels ? <AddModelPage /> : <NoAccess>Uploading models requires the Artist or Admin role.</NoAccess>) },
      { path: '/models/:id/add', render: ({ params }) => (can.manageModels ? <AddModelPage modelId={params.id} /> : <NoAccess>Capturing angles requires the Artist or Admin role.</NoAccess>) },
      { path: '/models/:id/update', render: ({ params }) => <ModelCapturesPage modelId={params.id} /> },
      { path: '/configurator', render: () => (can.configure ? <ConfigureListPage /> : <NoAccess>The configurator is open to the Admin, Analyst and Customer roles.</NoAccess>) },
      { path: '/configurator/:id', render: ({ params }) => (can.configure ? <ImageConfiguratorPage modelId={params.id} /> : <NoAccess>The configurator is open to the Admin, Analyst and Customer roles.</NoAccess>) },
      // The original standalone 3D tool, kept reachable — it needs no backend and is
      // the quickest way to check a .glb before it is uploaded to anything.
      { path: '/studio', render: () => <App /> },
    ],
    [can.manageModels, can.configure]
  );

  if (checking) return <Splash />;

  if (path === '/login') return <LoginPage />;
  if (path === '/forgot-password') return <ForgotPasswordPage />;
  if (!isAuthenticated) return <Splash />;

  return (
    <AppShell>
      <Routes
        routes={routes}
        fallback={
          <div className="uh-page">
            <Empty
              title="Page not found"
              action={
                <button className="uh-btn gold" onClick={() => navigate(home)}>
                  Go to {can.manageModels ? 'Models & Captures' : 'the configurator'}
                </button>
              }
            >
              <code>{path}</code> doesn't match anything in this application.
            </Empty>
          </div>
        }
      />
    </AppShell>
  );
}

export default function Root() {
  return (
    <AuthProvider>
      <RouterProvider>
        <Shell />
      </RouterProvider>
    </AuthProvider>
  );
}
