/**
 * App routing + shell (UX-SPEC §2, UI-SPEC §4). The Shell wraps every route and
 * owns the global logo gestures: long-press → staff/admin sign-in, tap → the
 * prototype tools panel (non-production only; in production the tap handler is
 * omitted and the panel is never rendered).
 *
 * Route guards for staff/admin live inside the screens themselves (they consult
 * `useAuth`), so there is no RequireAuth wrapper here. HashRouter keeps GitHub
 * Pages happy — client routes live after the `#`, no server rewrites needed.
 */

import { useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Shell } from './ui/app/Shell';
import { EntryResolver } from './ui/app/EntryResolver';
import { ROUTES } from './ui/app/routes';
import { isProduction } from './config/env';

import { Welcome } from './ui/screens/customer/Welcome';
import { Register } from './ui/screens/customer/Register';
import { LostCard } from './ui/screens/customer/LostCard';
import { RecoverConsume } from './ui/screens/customer/RecoverConsume';
import { CardView } from './ui/screens/customer/CardView';
import { StaffLogin } from './ui/screens/staff/StaffLogin';
import { StaffUnlock } from './ui/screens/staff/StaffUnlock';
import { StaffPanel } from './ui/screens/staff/StaffPanel';
import { ScanWorkflow } from './ui/screens/staff/ScanWorkflow';
import { AdminHome } from './ui/screens/admin/AdminHome';
import { ProtoPanel } from './ui/screens/proto/ProtoPanel';
import { PairDevices } from './ui/common/PairDevices';

export function App() {
  const navigate = useNavigate();
  const [protoOpen, setProtoOpen] = useState(false);

  return (
    <Shell
      onLogoTap={isProduction ? undefined : () => setProtoOpen(true)}
      onLogoHold={() => navigate(ROUTES.login)}
    >
      <Routes>
        <Route path="/" element={<EntryResolver />} />

        {/* Customer-facing */}
        <Route path={ROUTES.welcome} element={<Welcome />} />
        <Route path={ROUTES.register} element={<Register />} />
        <Route path={ROUTES.lost} element={<LostCard />} />
        <Route path={ROUTES.recoverWithCode} element={<RecoverConsume />} />
        <Route path={ROUTES.recover} element={<Navigate to={ROUTES.lost} replace />} />
        <Route path={ROUTES.card} element={<CardView />} />
        <Route path={ROUTES.cardSelf} element={<CardView />} />

        {/* Staff / admin (guards live inside the screens) */}
        <Route path={ROUTES.login} element={<StaffLogin />} />
        <Route path={ROUTES.staffUnlock} element={<StaffUnlock />} />
        <Route path={ROUTES.staff} element={<StaffPanel />} />
        <Route path={ROUTES.staffScan} element={<ScanWorkflow />} />
        <Route path={ROUTES.admin} element={<AdminHome />} />
        <Route path="/admin/:section" element={<AdminHome />} />

        {/* Prototype scaffolding */}
        <Route path={ROUTES.pair} element={<PairDevices />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {isProduction ? null : (
        <ProtoPanel open={protoOpen} onClose={() => setProtoOpen(false)} />
      )}
    </Shell>
  );
}
