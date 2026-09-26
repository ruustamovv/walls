/**
 * Legacy /lobby route — the play lobby now lives at /play.
 */
import { Navigate } from 'react-router-dom';

export default function LobbyPage() {
  return <Navigate to="/play" replace />;
}
