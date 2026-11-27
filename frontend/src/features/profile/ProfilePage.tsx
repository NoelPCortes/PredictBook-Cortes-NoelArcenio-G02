import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../api/authState'
import Brand from '../../components/Brand'
import { useSignOut } from '../../components/useSignOut'
import { ROLE_LANDING_PATHS } from '../../types/auth'
import ProfileInformation from './ProfileInformation'
import PasswordSecurity from './PasswordSecurity'
import '../../components/AuthLayout.css'
import './ProfilePage.css'

const accountSections = ['profile-information', 'password-security'] as const

type AccountSection = typeof accountSections[number]

export default function ProfilePage() {
  const { profile } = useAuth()
  const { signOut, isSigningOut } = useSignOut()
  const location = useLocation()
  const [activeSection, setActiveSection] = useState<AccountSection>(
    location.hash === '#password-security' ? 'password-security' : 'profile-information',
  )
  const sidebarRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const hasProfile = Boolean(profile)

  useEffect(() => {
    const content = contentRef.current
    const sidebar = sidebarRef.current
    if (!content || !sidebar) return

    const visibleSections = new Set<string>()
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) visibleSections.add(target.id)
        else visibleSections.delete(target.id)
      }
      const current = [...accountSections].reverse().find(section => visibleSections.has(section))
      if (current) setActiveSection(current)
    }, { rootMargin: `0px 0px -${Math.round(window.innerHeight * 0.4)}px 0px` })
    for (const section of accountSections) {
      const element = content.querySelector(`#${section}`)
      if (element) observer?.observe(element)
    }

    const updateSidebarHeight = () => {
      content.style.setProperty('--profile-sidebar-height', `${sidebar.offsetHeight}px`)
    }
    updateSidebarHeight()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSidebarHeight)
    resizeObserver?.observe(sidebar)
    return () => {
      observer?.disconnect()
      resizeObserver?.disconnect()
    }
  }, [hasProfile])

  function selectSection(section: AccountSection) {
    setActiveSection(section)
    const element = contentRef.current?.querySelector<HTMLElement>(`#${section}`)
    element?.focus({ preventScroll: true })
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    element?.scrollIntoView?.({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' })
  }

  if (!profile) return null
  const landingLabel = profile.role === 'head' ? 'Head management' : profile.role === 'staff' ? 'Dashboard' : 'Home'
  return <div className="profile-page">
    <aside className="profile-sidebar" ref={sidebarRef}>
      <Brand to={ROLE_LANDING_PATHS[profile.role]} />
      <nav aria-label="Account navigation">
        <Link to={ROLE_LANDING_PATHS[profile.role]}>{landingLabel}</Link>
        <p>My account</p>
        <Link to="/profile#profile-information" onClick={() => selectSection('profile-information')} aria-current={activeSection === 'profile-information' ? 'location' : undefined}>Profile Information</Link>
        <Link to="/profile#password-security" onClick={() => selectSection('password-security')} aria-current={activeSection === 'password-security' ? 'location' : undefined}>Password &amp; Security</Link>
      </nav>
      <button type="button" onClick={signOut} disabled={isSigningOut}>{isSigningOut ? 'Signing out…' : 'Sign Out'}</button>
    </aside>
    <main className="profile-content" ref={contentRef}>
      <header><p className="eyebrow">My account</p><h1>My account</h1><p>Manage your account details and security.</p></header>
      <ProfileInformation profile={profile} />
      <PasswordSecurity />
    </main>
  </div>
}
