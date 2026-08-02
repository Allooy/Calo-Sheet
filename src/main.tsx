import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { applyTheme, readTheme } from './lib/theme'

// Before first paint. CSP forbids the usual inline <head> script, so this is the
// earliest hook available — the entry module runs before React mounts.
applyTheme(readTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
