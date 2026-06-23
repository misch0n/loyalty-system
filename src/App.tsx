/**
 * App routing + logo gestures (UX-SPEC §2, Ckyka reference).
 *
 * There is no global chrome: each screen renders its own full-bleed `.screen`
 * surface and its own logo where the reference shows one. The app provides the
 * logo-gesture handlers once via `LogoGesturesProvider`:
 *   - tap        → home ('/' → entry resolver → welcome/card/staff/admin)
 *   - long-press → staff/admin sign-in
 *
 * The prototype tools panel is opened by its own dedicated hidden trigger in the
 * top-left corner (`DevTrigger`), present on every view in prototype builds —
 * keeping it independent of the logo's "go home" behaviour.
 *
 * Route guards for staff/admin live inside the screens (they consult `useAuth`).
 * HashRouter keeps GitHub Pages happy — client routes live after the `#`.
 */

import { useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LogoGesturesProvider } from './ui/app/LogoGestures';
import { DevTrigger } from './ui/app/DevTrigger';
import { EntryResolver } from './ui/app/EntryResolver';
import { ROUTES } from './ui/app/routes';
import { isPrototype } from './config/env';

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
import { ProtoPanel } from './ui/screens/proto/ProtoPanel/ProtoPanel';
import { PairDevices } from './ui/common/PairDevices';

export function App() {
  const navigate = useNavigate();
  const [protoOpen, setProtoOpen] = useState(false);

  return (
    <LogoGesturesProvider
      value={{
        onHome: () => navigate('/'),
        onHold: () => navigate(ROUTES.login),
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

        {/* Prototype scaffolding */}
        <Route path={ROUTES.pair} element={<PairDevices />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {isPrototype ? (
        <>
          <DevTrigger onOpen={() => setProtoOpen(true)} />
          <ProtoPanel open={protoOpen} onClose={() => setProtoOpen(false)} />
        </>
      ) : null}
    </LogoGesturesProvider>
  );
}
