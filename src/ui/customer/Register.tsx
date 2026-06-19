/** Standalone registration route (real second device, e.g. via PeerJS). */

import { useParams } from 'react-router-dom';
import { RegisterForm } from './RegisterForm';

export function Register() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) {
    return (
      <div className="card">
        <h2>No registration session</h2>
        <p>Ask staff to start a new card and scan the code shown at the till.</p>
      </div>
    );
  }
  return <RegisterForm sessionId={sessionId} />;
}
