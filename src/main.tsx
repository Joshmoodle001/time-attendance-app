import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AuthApp from './AuthApp.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthApp />
    </ErrorBoundary>
  </StrictMode>,
)
