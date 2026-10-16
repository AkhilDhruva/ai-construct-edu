import { lazy, Suspense, useEffect } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router'
import { SESSION_END_LABEL } from './mantle/session/session'
import { Onboarding } from './routes/Onboarding'
import { useMantle } from './state/useMantle'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { RungBadge } from './ui/RungBadge'

// Route-level code splitting: the shell and onboarding load first; each page loads on demand
// and the service worker precaches every chunk for offline use.
const Concept = lazy(() => import('./routes/Concept').then((m) => ({ default: m.Concept })))
const Drill = lazy(() => import('./routes/Drill').then((m) => ({ default: m.Drill })))
const Home = lazy(() => import('./routes/Home').then((m) => ({ default: m.Home })))
const KnowledgeCheck = lazy(() => import('./routes/KnowledgeCheck').then((m) => ({ default: m.KnowledgeCheck })))
const Lab = lazy(() => import('./routes/Lab').then((m) => ({ default: m.Lab })))
const Review = lazy(() => import('./routes/Review').then((m) => ({ default: m.Review })))
const Settings = lazy(() => import('./routes/Settings').then((m) => ({ default: m.Settings })))
const Tentacle = lazy(() => import('./routes/Tentacle').then((m) => ({ default: m.Tentacle })))
const Trace = lazy(() => import('./routes/Trace').then((m) => ({ default: m.Trace })))
const MapPage = lazy(() => import('./routes/Map').then((m) => ({ default: m.MapPage })))
const Studio = lazy(() => import('./routes/Studio').then((m) => ({ default: m.Studio })))

function SessionBanner() {
  const { sessionEnd, dismissSessionEnd } = useMantle()
  if (!sessionEnd) return null
  return (
    <div className="callout callout-warn" role="status" style={{ marginBottom: 16 }}>
      <strong>Session closed: {sessionEnd.reason}.</strong> {SESSION_END_LABEL[sessionEnd.reason]}, so the session loop stopped and a fresh one began. Your progress is
      saved.{' '}
      <button type="button" className="btn btn-sm" onClick={dismissSessionEnd}>
        Dismiss
      </button>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const { rung, due, learner, authorMode } = useMantle()
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <NavLink to="/" className="brand" aria-label="VeraClause Mantle home">
            <img src="/favicon.svg" alt="" />
            <span>
              VeraClause Mantle
              <small>AI Construct Education</small>
            </span>
          </NavLink>
          {learner?.onboarded && (
            <nav className="nav" aria-label="Main">
              <NavLink to="/" end>
                Plan
              </NavLink>
              <NavLink to="/review">
                Review{due.length > 0 && <span className="count" aria-label={`${due.length} cards due`}>{due.length}</span>}
              </NavLink>
              <NavLink to="/map">Map</NavLink>
              <NavLink to="/trace">Trace</NavLink>
              {authorMode && <NavLink to="/studio">Studio</NavLink>}
              <NavLink to="/settings">Settings</NavLink>
            </nav>
          )}
          <RungBadge rung={rung} />
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <SessionBanner />
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<p role="status">Loading…</p>}>{children}</Suspense>
        </ErrorBoundary>
      </main>
      <footer className="app-footer">
        VeraClause Mantle teaches agentic AI system design and runs as one: bounded session loop, typed results, four memory tiers, visible degradation ladder.
        Concepts are taught in original words; book chapters are cited as sources.
      </footer>
    </>
  )
}

export function App() {
  const { status, error, learner } = useMantle()
  if (status === 'booting') {
    return (
      <main id="main">
        <p role="status">Loading Mantle…</p>
      </main>
    )
  }
  if (status === 'error') {
    return (
      <main id="main">
        <div className="callout callout-danger" role="alert">
          <strong>Mantle could not start.</strong> {error}
        </div>
      </main>
    )
  }
  const onboarded = learner?.onboarded
  return (
    <Shell>
      <Routes>
        <Route path="/onboarding" element={onboarded ? <Navigate to="/" replace /> : <Onboarding />} />
        <Route path="/settings" element={<Settings />} />
        {!onboarded ? (
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        ) : (
          <>
            <Route path="/" element={<Home />} />
            <Route path="/review" element={<Review />} />
            <Route path="/trace" element={<Trace />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/studio" element={<Studio />} />
            <Route path="/t/:tentacle" element={<Tentacle />} />
            <Route path="/t/:tentacle/c/:concept" element={<Concept />} />
            <Route path="/t/:tentacle/lab/:lab" element={<Lab />} />
            <Route path="/t/:tentacle/check" element={<KnowledgeCheck />} />
            <Route path="/t/:tentacle/drill/:drill" element={<Drill />} />
            <Route path="*" element={<NotFound />} />
          </>
        )}
      </Routes>
    </Shell>
  )
}

function NotFound() {
  return (
    <div className="card">
      <h1>Not found</h1>
      <p>
        That page is not part of any installed tentacle. <NavLink to="/">Back to your plan</NavLink>.
      </p>
    </div>
  )
}
