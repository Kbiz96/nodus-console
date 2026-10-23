import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase.ts";
import { isApproved } from "./lib/data.ts";
import { friendlyError, isNotAllowed } from "./lib/rules.ts";
import Layout from "./components/Layout.tsx";
import { Logo } from "./components/Brand.tsx";
import { Loading, NOT_APPROVED, NotFound } from "./components/ui.tsx";
import Login from "./pages/Login.tsx";
import Today from "./pages/Today.tsx";
import Matches from "./pages/Matches.tsx";
import MatchDetail from "./pages/MatchDetail.tsx";
import Opportunities from "./pages/Opportunities.tsx";
import OpportunityDetail from "./pages/OpportunityDetail.tsx";
import OrganisationDetail from "./pages/OrganisationDetail.tsx";
import Signals from "./pages/Signals.tsx";
import SignalDetail from "./pages/SignalDetail.tsx";
import Mandates from "./pages/Mandates.tsx";
import Sources from "./pages/Sources.tsx";
import Spend from "./pages/Spend.tsx";
import Search from "./pages/Search.tsx";
import Contacts from "./pages/Contacts.tsx";
import Deals from "./pages/Deals.tsx";
import Outreach from "./pages/Outreach.tsx";
import Import from "./pages/Import.tsx";
import Engine from "./pages/Engine.tsx";
// The map library is large: load it only when the Map page is opened.
const MapView = lazy(() => import("./pages/MapView.tsx"));

type Access = "checking" | "approved" | "refused" | { error: string };

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [access, setAccess] = useState<Access>("checking");
  const [attempt, setAttempt] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();
  // After an emailed sign-in link, the router briefly sees the token fragment as a page; send it to Today.
  useEffect(() => {
    if (session && /access_token|refresh_token|type=magiclink/.test(location.pathname)) navigate("/", { replace: true });
  }, [session, location.pathname, navigate]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    setAccess("checking");
    isApproved().then(
      (ok) => live && setAccess(ok ? "approved" : "refused"),
      (e) => live && setAccess(isNotAllowed(e) ? "refused" : { error: friendlyError(e) }),
    );
    return () => {
      live = false;
    };
  }, [userId, attempt]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  if (session === undefined) return <Splash text="Loading…" />;
  if (!session) return <Login />;
  if (access === "checking") return <Splash text="Checking your access…" />;
  if (access === "refused") {
    return (
      <Splash text={NOT_APPROVED}>
        <p className="muted small">Signed in as {session.user.email}. Ask Nodus to add this email to the approved list, or sign in with a different account.</p>
        <button className="btn" onClick={signOut}>Sign out</button>
      </Splash>
    );
  }
  if (typeof access === "object") {
    return (
      <Splash text="Could not check your access.">
        <p className="muted small">{access.error}</p>
        <div className="action-row">
          <button className="btn primary" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          <button className="btn ghost" onClick={signOut}>Sign out</button>
        </div>
      </Splash>
    );
  }

  return (
    <Layout email={session.user.email ?? null} onSignOut={signOut}>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/engine" element={<Engine />} />
        <Route path="/map" element={<Suspense fallback={<Loading what="Loading the map…" />}><MapView /></Suspense>} />
        <Route path="/matches" element={<Matches />} />
        <Route path="/matches/:id" element={<MatchDetail />} />
        <Route path="/opportunities" element={<Opportunities />} />
        <Route path="/opportunities/:id" element={<OpportunityDetail />} />
        <Route path="/organisations/:id" element={<OrganisationDetail />} />
        <Route path="/signals" element={<Signals />} />
        <Route path="/signals/:id" element={<SignalDetail />} />
        <Route path="/mandates" element={<Mandates />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="/spend" element={<Spend />} />
        <Route path="/search" element={<Search />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/deals" element={<Deals />} />
        <Route path="/outreach" element={<Outreach />} />
        <Route path="/import" element={<Import />} />
        <Route path="*" element={<NotFound what="page" />} />
      </Routes>
    </Layout>
  );
}

function Splash({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="login-wrap">
      <div className="card login-card" role="status">
        <Logo />
        <h1>Origination console</h1>
        <p>{text}</p>
        {children}
      </div>
    </div>
  );
}
