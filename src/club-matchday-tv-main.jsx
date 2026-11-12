import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { StandaloneClubMatchdayTv } from './pages/StandaloneClubMatchdayTv.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MemoryRouter>
      <StandaloneClubMatchdayTv />
    </MemoryRouter>
  </StrictMode>,
)
