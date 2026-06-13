import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/theme.css';

// Note: StrictMode is intentionally omitted — its dev double-invocation of effects double-requests
// the camera and re-runs FaceMesh init (the original VisuLab was a production build with no
// StrictMode). Production behaviour is unchanged.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
