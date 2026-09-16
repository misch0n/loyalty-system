/**
 * App routing + logo gestures (UX-SPEC §2, Ckyka reference).
 *
 * There is no global chrome: each screen renders its own full-bleed `.screen`
 * surface and its own logo where the reference shows one. The app provides the
 * logo-gesture handlers once via `LogoGesturesProvider`:
 *   - tap        → home ('/' → entry resolver → welcome/card/staff/admin)
 *   - long-press → staff/admin sign-in
 *
 * The developer panel and its hidden trigger are gone (UI-0): there are no
 * adapters left to choose between, so there was nothing for the panel to do.
 *
 * Route guards for staff/admin live inside the screens (they consult `useAuth`).
 * HashRouter keeps the SPA on one static path — client routes live after the `#`.
 */

import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LogoGesturesProvider } from './ui/app/LogoGestures';
import { EntryResolver } from './ui/app/EntryResolver';
import { useAuth } from './ui/app/AuthContext';
import { ROUTES } from './ui/app/routes';

import { Welcome } from './ui/screens/customer/Welcome/Welcome';
import { Register } from './ui/screens/customer/Register/Register';
import { LostCard } from './ui/screens/customer/LostCard/LostCard';
import { RecoverConsume } from './ui/screens/customer/RecoverConsume/RecoverConsume';
import { Card } from './ui/screens/customer/Card/Card';
import { Login } from './ui/screens/staff/Login/Login';
import { Unlock } from './ui/screens/staff/Unlock/Unlock';
import { Panel } from './ui/screens/staff/Panel/Panel';
import { Scan } from './ui/screens/staff/Scan/Scan';
import { Admin } from './ui/screens/admin/Admin/Admin';

export function App() {
  const navigate = useNavigate();
  const { actor, status } = useAuth();

  // When already signed in, the logo (tap OR long-press) goes to the counter —
  // never back to the sign-in page. Admins reach the admin panel via the
  // "Go to admin" button on the counter. Sign-in is reached manually
  // (long-press) only while signed out.
  const signedIn = Boolean(actor) && status === 'active';

  return (
    <LogoGesturesProvider
      value={{
        onHome: () => navigate('/'),
        onHold: () => navigate(signedIn ? ROUTES.staff : ROUTES.login),
      }}
    >
      <Routes>
        <Route path="/" element={<EntryResolver />} />

        {/* Customer-facing */}
        <Route path={ROUTES.welcome} element={<Welcome />} />
        <Route path={ROUTES.register} element={<Register />} />
        <Route path={ROUTES.lost} element={<LostCard />} />
        <Route path={ROUTES.recoverWithCode} element={<RecoverConsume />} />
        <Route path={ROUTES.recover} element={<Navigate to={ROUTES.lost} replace />} />
        <Route path={ROUTES.card} element={<Card />} />
        <Route path={ROUTES.cardSelf} element={<Card />} />

        {/* Staff / admin (guards live inside the screens) */}
        <Route path={ROUTES.login} element={<Login />} />
        <Route path={ROUTES.staffUnlock} element={<Unlock />} />
        <Route path={ROUTES.staff} element={<Panel />} />
        <Route path={ROUTES.staffScan} element={<Scan />} />
        <Route path={ROUTES.admin} element={<Admin />} />
        <Route path="/admin/:section" element={<Admin />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LogoGesturesProvider>
  );
}
