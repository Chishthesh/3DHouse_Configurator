import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// A hash router in ~70 lines rather than a dependency.
//
// This codebase already reads .xlsx without SheetJS; adding react-router for seven
// routes would be out of keeping, and hash routing has a practical advantage here:
// the built app is a static bundle that can be served from Blob Storage or any
// subpath without server-side rewrite rules.

const RouteContext = createContext(null);

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  return {
    path: path.length > 1 ? path.replace(/\/+$/, '') : path,
    query: Object.fromEntries(new URLSearchParams(queryPart ?? '')),
  };
}

export function navigate(to, { replace = false } = {}) {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

export function RouterProvider({ children }) {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      // Each route is a new screen; carrying the previous scroll position into it
      // lands the user halfway down a list they have not seen.
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    if (!window.location.hash) navigate('/', { replace: true });
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return <RouteContext.Provider value={route}>{children}</RouteContext.Provider>;
}

export function useRoute() {
  const ctx = useContext(RouteContext);
  if (!ctx) throw new Error('useRoute must be used inside <RouterProvider>.');
  return ctx;
}

/**
 * Matches a pattern like "/models/:id/captures" against the current path and
 * returns the named parameters, or null when it doesn't match.
 */
export function matchPath(pattern, path) {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;

  const params = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i].toLowerCase() !== a[i].toLowerCase()) return null;
  }
  return params;
}

/** An <a> that routes without a full page load, and knows when it is the current page. */
export function Link({ to, className = '', activeClassName = 'active', children, ...rest }) {
  const { path } = useRoute();
  const isActive = path === to || (to !== '/' && path.startsWith(`${to}/`));

  const onClick = useCallback(
    (e) => {
      // Leave modified clicks alone so "open in new tab" still works.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
    },
    [to]
  );

  return (
    <a href={`#${to}`} className={`${className} ${isActive ? activeClassName : ''}`.trim()} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}

/** Picks the first route whose pattern matches, and passes it the URL parameters. */
export function Routes({ routes, fallback = null }) {
  const { path, query } = useRoute();

  const matched = useMemo(() => {
    for (const r of routes) {
      const params = matchPath(r.path, path);
      if (params) return { route: r, params };
    }
    return null;
  }, [routes, path]);

  if (!matched) return fallback;
  return matched.route.render({ params: matched.params, query });
}
