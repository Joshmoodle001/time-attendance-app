import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import DesktopReportWorker from './components/DesktopReportWorker.tsx'

const searchParams = new URLSearchParams(window.location.search)
const isDesktopReportWorker = searchParams.get('desktopReportWorker') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isDesktopReportWorker ? <DesktopReportWorker /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
