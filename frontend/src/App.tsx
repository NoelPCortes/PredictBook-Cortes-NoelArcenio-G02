import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import SignInPage from './features/signin/SignInPage'
import SignUpPage from './features/signup/SignUpPage'
import HomePage from './features/homepage/HomePage'
import { loadProfile } from './features/homepage/api'
import { clearSession, setProfile, useAuth } from './api/authState'
import { readTokens } from './api/authStorage'
import RoleRoute from './components/RoleRoute'
import { ROLE_LANDING_PATHS } from './types/auth'
import StaffDashboard from './features/staff-dashboard/StaffDashboard'
import HeadPage from './features/head/HeadPage'
import ProfilePage from './features/profile/ProfilePage'
import FlightListPage from './features/flights/FlightListPage'
import FlightFormPage from './features/flights/FlightFormPage'
import ForecastListPage from './features/calendar/ForecastListPage'
import ForecastFormPage from './features/calendar/ForecastFormPage'
import TrafficCalendarPage from './features/calendar/TrafficCalendarPage'
import ErrorBoundary from './components/ErrorBoundary'
import NotFoundPage from './components/NotFoundPage'

function SessionBootstrap({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  const [isChecking, setIsChecking] = useState(() => Boolean(readTokens()))
  useEffect(() => { navigateRef.current = navigate }, [navigate])
  useEffect(() => {
    let isActive = true
    const expire = () => { clearSession(); navigateRef.current('/signin', { replace: true }) }
    window.addEventListener('auth:expired', expire)
    if (readTokens()) {
      void loadProfile().then(profile => { if (isActive) setProfile(profile) })
        .catch(() => { if (isActive) expire() })
        .finally(() => { if (isActive) setIsChecking(false) })
    } else {
      clearSession()
    }
    return () => { isActive = false; window.removeEventListener('auth:expired', expire) }
  }, [])
  if (isChecking) return <p role="status">Checking your session…</p>
  return children
}

export function SessionRoute({ children, isProtected = false }: { children: ReactNode; isProtected?: boolean }) {
  const { profile, isLoading } = useAuth()
  if (isLoading) return <p role="status">Checking your session…</p>
  if (isProtected && !profile) return <Navigate to="/signin" replace />
  if (!isProtected && profile) return <Navigate to={ROLE_LANDING_PATHS[profile.role]} replace />
  return children
}

export function AppRoutes() {
  return <SessionBootstrap><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/signin" element={<SessionRoute><SignInPage /></SessionRoute>} />
    <Route path="/signup" element={<SessionRoute><SignUpPage /></SessionRoute>} />
    <Route path="/home" element={<RoleRoute allowedRoles={['traveler']}><HomePage /></RoleRoute>} />
    <Route path="/calendar" element={<RoleRoute allowedRoles={['traveler']}><TrafficCalendarPage /></RoleRoute>} />
    <Route path="/staff/dashboard" element={<RoleRoute allowedRoles={['staff', 'head']}><StaffDashboard /></RoleRoute>} />
    <Route path="/staff/flights" element={<RoleRoute allowedRoles={['staff', 'head']}><FlightListPage /></RoleRoute>} />
    <Route path="/staff/flights/new" element={<RoleRoute allowedRoles={['staff', 'head']}><FlightFormPage /></RoleRoute>} />
    <Route path="/staff/flights/:id/edit" element={<RoleRoute allowedRoles={['staff', 'head']}><FlightFormPage /></RoleRoute>} />
    <Route path="/staff/forecasts" element={<RoleRoute allowedRoles={['staff', 'head']}><ForecastListPage /></RoleRoute>} />
    <Route path="/staff/forecasts/new" element={<RoleRoute allowedRoles={['staff', 'head']}><ForecastFormPage /></RoleRoute>} />
    <Route path="/staff/forecasts/:id/edit" element={<RoleRoute allowedRoles={['staff', 'head']}><ForecastFormPage /></RoleRoute>} />
    <Route path="/head" element={<RoleRoute allowedRoles={['head']}><HeadPage /></RoleRoute>} />
    <Route path="/profile" element={<SessionRoute isProtected><ProfilePage /></SessionRoute>} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes></SessionBootstrap>
}

export default function App() {
  return <ErrorBoundary><BrowserRouter><AppRoutes /></BrowserRouter></ErrorBoundary>
}



