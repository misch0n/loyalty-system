/**
 * App shell + routing. HashRouter keeps GitHub Pages happy (client routes live
 * after the '#', so no server rewrites are needed). The header's role switcher
 * lets one browser stand in for staff, admin, and customer devices.
 */

import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './ui/common/Layout';
import { RequireAuth } from './ui/common/RequireAuth';
import { LoginScreen } from './ui/auth/LoginScreen';
import { ScanHome } from './ui/staff/ScanHome';
import { IssueCard } from './ui/staff/IssueCard';
import { FindCustomer } from './ui/staff/FindCustomer';
import { StaffAdmin } from './ui/admin/StaffAdmin';
import { ProgramConfig } from './ui/admin/ProgramConfig';
import { Stats } from './ui/admin/Stats';
import { AuditLog } from './ui/admin/AuditLog';
import { PairDevices } from './ui/common/PairDevices';
import { CustomerHome } from './ui/customer/CustomerHome';
import { SelfRegister } from './ui/customer/SelfRegister';
import { Register } from './ui/customer/Register';
import { Recover } from './ui/customer/Recover';
import { Status } from './ui/customer/Status';
import { DeleteData } from './ui/customer/DeleteData';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<CustomerHome />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/pair" element={<PairDevices />} />

        {/* Staff */}
        <Route
          path="/staff"
          element={
            <RequireAuth>
              <ScanHome />
            </RequireAuth>
          }
        />
        <Route
          path="/staff/issue"
          element={
            <RequireAuth>
              <IssueCard />
            </RequireAuth>
          }
        />
        <Route
          path="/staff/find"
          element={
            <RequireAuth>
              <FindCustomer />
            </RequireAuth>
          }
        />

        {/* Admin */}
        <Route
          path="/admin/staff"
          element={
            <RequireAuth requireAdmin>
              <StaffAdmin />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/program"
          element={
            <RequireAuth requireAdmin>
              <ProgramConfig />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/stats"
          element={
            <RequireAuth requireAdmin>
              <Stats />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <RequireAuth requireAdmin>
              <AuditLog />
            </RequireAuth>
          }
        />

        {/* Customer-facing */}
        <Route path="/register" element={<SelfRegister />} />
        <Route path="/register/:sessionId" element={<Register />} />
        <Route path="/recover" element={<Recover />} />
        <Route path="/recover/:code" element={<Recover />} />
        <Route path="/status" element={<Status />} />
        <Route path="/status/:token" element={<Status />} />
        <Route path="/delete/:token" element={<DeleteData />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
