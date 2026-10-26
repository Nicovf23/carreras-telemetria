import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import './index.css';
import { PublicLayout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { RacePage } from './pages/RacePage';
import { RiderPage } from './pages/RiderPage';
import { Spinner } from './components/ui';

// El panel del organizador se carga bajo demanda: los espectadores no lo descargan.
const AdminApp = lazy(() => import('./pages/admin/AdminApp').then((m) => ({ default: m.AdminApp })));

function NotFound() {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-xl p-10 text-center">
        <h1 className="text-2xl font-bold">Página no encontrada</h1>
        <Link to="/" className="btn-primary mt-6">
          Ir a las carreras
        </Link>
      </div>
    </PublicLayout>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/carreras/:slug" element={<RacePage />} />
        <Route path="/carreras/:slug/participantes/:bib" element={<RiderPage />} />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<Spinner />}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
