import { FormEvent, useEffect, useState } from 'react'
import {
  API_BASE,
  apiRequest,
  Campus,
  clearSession,
  LOCAL_AUTH_ENABLED,
  getAccessToken,
  getDemoRole,
  getSelectedCampus,
  Role,
  storeSession,
} from './auth'

type ApiState = 'checking' | 'online' | 'offline'
type LoginResponse = { access_token: string; role: Role; tenant: Campus }
type RegistrationResponse = {
  status: 'registered'
  message: string
  access_token: string
  role: Role
  tenant: Campus
}
type Analytics = {
  tenant_name: string
  total_students: number
  total_faculty: number
  total_courses: number
  attendance_rate_percent: number
  total_enrollments: number
  todays_attendance: number
  upcoming_examinations: number
  uploaded_documents: number
}
type PlatformSummary = {
  tenant_code: string
  tenant_name: string
  student_count: number
  faculty_count: number
  course_count: number
}[]

const roleLabels: Record<Role, string> = {
  college_admin: 'College Admin',
  faculty: 'Faculty',
  student: 'Student',
  platform_admin: 'Super Admin',
}

function ErrorMessage({ children }: { children: string }) {
  return <p className="form-error" role="alert">{children}</p>
}

function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [apiState, setApiState] = useState<ApiState>('checking')
  const [campuses, setCampuses] = useState<Campus[]>([])
  const [campusLoading, setCampusLoading] = useState(false)
  const [campusError, setCampusError] = useState('')
  const [campus, setCampus] = useState<Campus | null>(getSelectedCampus)
  const [accessToken, setAccessToken] = useState<string | null>(getAccessToken)
  const [role, setRole] = useState<Role | null>(getDemoRole)
  const [loginError, setLoginError] = useState('')
  const [loginNotice, setLoginNotice] = useState('')
  const [welcomeMessage, setWelcomeMessage] = useState('')
  const [registrationError, setRegistrationError] = useState('')
  const [registrationMessage, setRegistrationMessage] = useState('')
  const [dashboardError, setDashboardError] = useState('')
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [platformSummary, setPlatformSummary] = useState<PlatformSummary>([])
  const [section, setSection] = useState('overview')

  const navigate = (destination: string) => {
    const pathname = destination.split('?')[0]
    window.history.pushState({}, '', destination)
    setPath(pathname)
    setLoginError('')
    setLoginNotice('')
    setRegistrationError('')
    setCampusError('')
    setDashboardError('')
  }

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    let active = true
    fetch(`${API_BASE}/health`)
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable')
        if (active) setApiState('online')
      })
      .catch(() => { if (active) setApiState('offline') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (path !== '/campuses') return
    let active = true
    setCampusLoading(true)
    setCampusError('')
    apiRequest<Campus[]>('/tenants/public')
      .then((result) => { if (active) setCampuses(result) })
      .catch((error: Error) => { if (active) setCampusError(error.message) })
      .finally(() => { if (active) setCampusLoading(false) })
    return () => { active = false }
  }, [path])

  useEffect(() => {
    if (path !== '/dashboard') return
    if (!accessToken || !campus || !role) {
      navigate('/campuses')
      return
    }

    let active = true
    setAnalytics(null)
    setPlatformSummary([])
    setDashboardError('')
    const loadDashboard = async () => {
      try {
        if (role === 'platform_admin') {
          const summary = await apiRequest<PlatformSummary>('/reports/multi-tenant-summary', {
            accessToken, tenantCode: campus.tenant_code,
          })
          if (active) setPlatformSummary(summary)
        } else if (role === 'college_admin') {
          const report = await apiRequest<Analytics>('/reports/analytics', {
            accessToken, tenantCode: campus.tenant_code,
          })
          if (active) setAnalytics(report)
        }
      } catch (error) {
        if (active) setDashboardError(error instanceof Error ? error.message : 'Dashboard data could not be loaded.')
      }
    }
    void loadDashboard()
    const refreshDashboard = () => { void loadDashboard() }
    window.addEventListener('campuscloud:data-changed', refreshDashboard)
    return () => { active = false; window.removeEventListener('campuscloud:data-changed', refreshDashboard) }
  }, [path, accessToken, campus, role])

  const chooseCampus = (selected: Campus) => {
    setCampus(selected)
    sessionStorage.setItem('campuscloud.selected_campus', JSON.stringify(selected))
    navigate('/login')
  }

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginError('')
    if (!campus) {
      navigate('/campuses')
      return
    }

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim().toLowerCase()
    const password = String(form.get('password') ?? '')
    try {
      const result = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, tenant_code: campus.tenant_code }),
      })
      storeSession(result.access_token, result.tenant, result.role)
      setAccessToken(result.access_token)
      setCampus(result.tenant)
      setRole(result.role)
      navigate('/dashboard')
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Email or password is incorrect.')
    }
  }

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setRegistrationError('')
    setRegistrationMessage('')
    if (!campus) {
      navigate('/campuses')
      return
    }

    const form = new FormData(event.currentTarget)
    const payload = {
      full_name: String(form.get('full_name') ?? '').trim(),
      email: String(form.get('register_email') ?? '').trim().toLowerCase(),
      password: String(form.get('register_password') ?? ''),
      confirm_password: String(form.get('confirm_password') ?? ''),
      tenant_code: campus.tenant_code,
    }
    if (payload.password !== payload.confirm_password) {
      setRegistrationError('Passwords do not match.')
      return
    }
    try {
      const result = await apiRequest<RegistrationResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      storeSession(result.access_token, result.tenant, result.role)
      setAccessToken(result.access_token)
      setCampus(result.tenant)
      setRole(result.role)
      setWelcomeMessage(result.message)
      setRegistrationMessage(result.message)
      navigate('/dashboard')
    } catch (error) {
      setRegistrationError(error instanceof Error ? error.message : 'Registration could not be completed.')
    }
  }

  const signOut = () => {
    clearSession()
    setAccessToken(null)
    setCampus(null)
    setRole(null)
    setAnalytics(null)
    navigate('/')
  }

  const statusText = apiState === 'checking'
    ? 'Connecting to the API…'
    : apiState === 'online'
      ? 'API connected'
      : 'API unavailable — start the local services'

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand-button" onClick={() => navigate('/')} aria-label="CampusCloud home">
          <span className="brand-mark">C</span><span>CampusCloud</span>
        </button>
        <span className="environment">{LOCAL_AUTH_ENABLED ? 'CAMPUS ACCOUNT ACCESS' : 'AUTHENTICATION UNAVAILABLE'}</span>
        {path !== '/dashboard' && <a className="top-signin" href="/campuses" onClick={(event) => { event.preventDefault(); navigate('/campuses') }}>Sign In</a>}
      </header>

      {path === '/' && (
        <section className="welcome">
          <p className="eyebrow">COLLEGE MANAGEMENT PLATFORM</p>
          <h1>Your campus,<br /><em>in one place.</em></h1>
          <p className="intro">A shared workspace for the people and programs that keep your institution moving.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => navigate('/campuses')}>Get Started <span aria-hidden="true">→</span></button>
            <a className="text-link" href="/campuses" onClick={(event) => { event.preventDefault(); navigate('/campuses') }}>Sign In</a>
          </div>
          <div className="service-status" role="status">
            <span className={`status-dot ${apiState}`} />
            <span>{statusText}</span>
          </div>
          <div className="phase-note"><span className="note-icon">✦</span><div><strong>A clearer view of campus life</strong><p>Choose your college and sign in to continue to your campus workspace.</p></div></div>
        </section>
      )}

      {path === '/campuses' && (
        <section className="journey-page campus-page">
          <button className="back-link" onClick={() => navigate('/')}>← Back to home</button>
          <p className="eyebrow">YOUR CAMPUS, YOUR WORKSPACE</p>
          <h1 className="page-title">Choose your <em>campus.</em></h1>
          <p className="page-intro">Select your institution to continue to its secure sign-in.</p>
          {campusLoading && <p className="muted-message" role="status">Loading campuses…</p>}
          {campusError && <ErrorMessage>{campusError}</ErrorMessage>}
          {!campusLoading && !campusError && campuses.length === 0 && <p className="muted-message">No active campuses are available.</p>}
          <div className="campus-grid">
            {campuses.map((item) => (
              <article className={`campus-card ${campus?.tenant_code === item.tenant_code ? 'selected' : ''}`} key={item.tenant_code}>
                <div className="campus-monogram" aria-hidden="true">{item.tenant_code.slice(0, 1)}</div>
                <div className="campus-copy"><span className="campus-code">{item.tenant_code}</span><h2>{item.name}</h2><p>CampusCloud institution workspace</p></div>
                <button className="secondary-button" onClick={() => chooseCampus(item)}>Continue <span aria-hidden="true">→</span></button>
              </article>
            ))}
          </div>
        </section>
      )}

      {path === '/login' && (
        <section className="journey-page login-page">
          <button className="back-link" onClick={() => navigate('/campuses')}>← Change campus</button>
          <div className="login-card">
            <div className="campus-monogram" aria-hidden="true">{campus?.tenant_code.slice(0, 1) ?? 'C'}</div>
            <p className="eyebrow">WELCOME BACK</p>
            <h1 className="page-title">Sign in to your <em>campus.</em></h1>
            <p className="selected-campus">{campus?.name ?? 'Select a campus to continue'}</p>
            {loginNotice && <p className="success-message" role="status">{loginNotice}</p>}
            {LOCAL_AUTH_ENABLED ? (
              <form className="login-form" onSubmit={(event) => { void signIn(event) }}>
                <label htmlFor="email">Email address</label>
                <input id="email" name="email" type="email" autoComplete="username" placeholder="you@college.edu" required />
                <label htmlFor="password">Password</label>
                <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required />
                {loginError && <ErrorMessage>{loginError}</ErrorMessage>}
                <button className="primary-button full-width" type="submit">Sign In <span aria-hidden="true">→</span></button>
                <p className="demo-note">Sign in with the account provisioned for your campus.</p>
              </form>
            ) : (
              <ErrorMessage>Campus account sign-in is not configured for this application build.</ErrorMessage>
            )}
            <p className="account-switch">New to CampusCloud? <a href="/register" onClick={(event) => { event.preventDefault(); navigate('/register') }}>Create Account</a></p>
          </div>
        </section>
      )}

      {path === '/register' && (
        <section className="journey-page login-page">
          <button className="back-link" onClick={() => navigate('/login')}>← Back to login</button>
          <div className="login-card registration-card">
            <div className="campus-monogram" aria-hidden="true">{campus?.tenant_code.slice(0, 1) ?? 'C'}</div>
            <p className="eyebrow">STUDENT REGISTRATION</p>
            <h1 className="page-title">Create your <em>account.</em></h1>
            <p className="selected-campus">{campus?.name ?? 'Select a campus to continue'}{campus ? ` · ${campus.tenant_code}` : ''}</p>
            {!campus && <button className="secondary-button full-width" onClick={() => navigate('/campuses')}>Choose a campus</button>}
            {registrationMessage && <p className="success-message" role="status">{registrationMessage}</p>}
            {registrationError && <ErrorMessage>{registrationError}</ErrorMessage>}
            {campus && (
              <form className="login-form" onSubmit={(event) => { void register(event) }}>
                <label htmlFor="full_name">Full name</label>
                <input id="full_name" name="full_name" type="text" autoComplete="name" maxLength={200} required />
                <label htmlFor="register_email">Email address</label>
                <input id="register_email" name="register_email" type="email" autoComplete="email" maxLength={254} required />
                <label htmlFor="register_password">Password</label>
                <input id="register_password" name="register_password" type="password" autoComplete="new-password" minLength={12} required />
                <label htmlFor="confirm_password">Confirm password</label>
                <input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={12} required />
                <p className="password-hint">Use at least 12 characters with uppercase, lowercase, a number, and a symbol.</p>
                <button className="primary-button full-width" type="submit">Create Student Account <span aria-hidden="true">→</span></button>
                <p className="demo-note">Public registration creates a Student account only. Faculty and administrator accounts require authorized provisioning.</p>
              </form>
            )}
            <p className="account-switch">Already registered? <a href="/login" onClick={(event) => { event.preventDefault(); navigate('/login') }}>Sign In</a></p>
          </div>
        </section>
      )}

      {path === '/dashboard' && accessToken && campus && role && (
        <section className="journey-page dashboard-page">
          <div className="dashboard-heading">
            <div><p className="eyebrow">{roleLabels[role].toUpperCase()} WORKSPACE</p><h1 className="page-title">Welcome to <em>{campus.name}.</em></h1><p className="page-intro">Your active campus is {campus.tenant_code}.</p></div>
            <button className="secondary-button signout-button" onClick={signOut}>Sign Out</button>
          </div>
          <div className="dashboard-banner"><span className="dashboard-role-mark">{roleLabels[role].slice(0, 1)}</span><div><strong>{roleLabels[role]}</strong><p>Signed in to {campus.name} · {campus.tenant_code}</p></div><span className="verified-pill">Verified access</span></div>
          {welcomeMessage && <p className="success-message dashboard-success" role="status">{welcomeMessage}</p>}
          {dashboardError && <ErrorMessage>{dashboardError}</ErrorMessage>}
          {role === 'college_admin' && analytics && <div className="stat-grid">
            <StatCard label="Active students" value={analytics.total_students} />
            <StatCard label="Faculty members" value={analytics.total_faculty} />
            <StatCard label="Active courses" value={analytics.total_courses} />
            <StatCard label="Attendance" value={`${analytics.attendance_rate_percent}%`} />
            <StatCard label="Enrollments" value={analytics.total_enrollments} />
            <StatCard label="Today's attendance" value={analytics.todays_attendance} />
            <StatCard label="Upcoming exams" value={analytics.upcoming_examinations} />
            <StatCard label="Documents" value={analytics.uploaded_documents} />
          </div>}
          {role === 'platform_admin' && <div className="platform-summary">
            <div className="section-heading"><div><h2>Campus overview</h2><p>Live totals from the active tenant registry.</p></div><span>{platformSummary.length} campuses</span></div>
            {platformSummary.length > 0 ? <div className="campus-grid summary-grid">{platformSummary.map((item) => <article className="summary-card" key={item.tenant_code}><span className="campus-code">{item.tenant_code}</span><h3>{item.tenant_name}</h3><p>{item.student_count} students · {item.faculty_count} faculty · {item.course_count} courses</p></article>)}</div> : !dashboardError && <p className="muted-message">Loading campus overview…</p>}
          </div>}
          {(role === 'faculty' || role === 'student') && <div className="role-welcome"><span className="note-icon">✦</span><div><strong>Your {roleLabels[role].toLowerCase()} workspace is ready</strong><p>Campus data is scoped to your authenticated {roleLabels[role].toLowerCase()} role and selected institution.</p></div></div>}
          {role === 'college_admin' && !analytics && !dashboardError && <p className="muted-message">Loading campus overview…</p>}
          <ManagementPanel role={role} section={section} setSection={setSection} campus={campus} token={accessToken} />
        </section>
      )}

      <footer><span>Built for connected campuses</span><span>SECURE · CAMPUS-SCOPED ACCESS</span></footer>
    </main>
  )
}

type PanelProps = { role: Role; section: string; setSection: (value: string) => void; campus: Campus; token: string }
type Row = Record<string, unknown>
const panels: Record<string, string[]> = {
  overview: [], tenants: ['/tenants'], reports: ['/reports/analytics'], students: ['/students'], faculty: ['/faculty'], courses: ['/courses'],
  attendance: ['/attendance'], examinations: ['/examinations'], documents: ['/storage/documents'],
  cloud: ['/info'],
}

function ManagementPanel({ role, section, setSection, campus, token }: PanelProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const nav = role === 'college_admin' ? ['overview','students','faculty','courses','attendance','examinations','documents','reports','cloud']
    : role === 'faculty' ? ['overview','courses','attendance','examinations','documents','cloud']
      : role === 'student' ? ['overview','profile','courses','attendance','examinations','documents','cloud'] : ['overview','tenants','cloud']
  const studentPage = role === 'student' && ['profile','courses','attendance','examinations','documents'].includes(section)
  const adminDataPage = role === 'college_admin' && ['data','students','faculty','courses'].includes(section)
  const operationalPage = ['attendance','examinations'].includes(section) && ['college_admin','faculty'].includes(role)
  const documentsPage = section === 'documents' && ['college_admin','faculty'].includes(role)
  useEffect(() => {
    if (section === 'overview' || studentPage || adminDataPage || operationalPage || documentsPage || (role==='faculty'&&section==='courses')) { setRows([]); return }
    let alive = true
    setBusy(true); setError(''); setNotice('')
    apiRequest<Row | Row[]>(section === 'cloud' ? '/info' : (panels[section]?.[0] ?? '/info'), { accessToken: token, tenantCode: campus.tenant_code })
      .then(value => { if (alive) setRows(Array.isArray(value) ? value : [value]) })
      .catch((reason: Error) => { if (alive) setError(reason.message) })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [section, token, campus.tenant_code, role])

  const createRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setNotice('')
    const targetForm = event.currentTarget
    const form = new FormData(targetForm)
    const body: Row = Object.fromEntries(form.entries())
    for (const key of ['semester','credits','max_marks']) if (body[key]) body[key] = Number(body[key])
    for (const key of ['date','enrollment_date','due_date']) if (body[key] === '') delete body[key]
    try {
      await apiRequest(panels[section][0], { method: 'POST', accessToken: token, tenantCode: campus.tenant_code, body: JSON.stringify(body) })
      setNotice('Saved successfully.'); targetForm.reset()
      const value = await apiRequest<Row[]>(panels[section][0], { accessToken: token, tenantCode: campus.tenant_code }); setRows(value)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The change could not be saved.') }
  }
  const updateRow = async (row: Row) => {
    if (!row.id) return
    const field = section === 'tenants' ? 'name' : section === 'students' ? 'semester' : section === 'faculty' ? 'designation' : section === 'courses' ? 'title' : ''
    if (!field) return
    const answer = window.prompt(`Update ${field.replace(/_/g,' ')}`, String(row[field] ?? ''))
    if (answer === null) return
    try {
      await apiRequest(`${panels[section][0]}/${row.id}`, { method: 'PATCH', accessToken: token, tenantCode: campus.tenant_code, body: JSON.stringify({ [field]: field === 'semester' ? Number(answer) : answer }) })
      setRows(rows.map(item => item.id === row.id ? { ...item, [field]: field === 'semester' ? Number(answer) : answer } : item))
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed.') }
  }
  const archiveRow = async (row: Row) => {
    if (!row.id) return
    if (!window.confirm(`${section === 'students' ? 'Delete' : section === 'courses' ? 'Archive' : 'Deactivate'} this ${section.slice(0,-1)} record?`)) return
    const url = section === 'students' ? `/students/${row.id}` : section === 'tenants' ? `/tenants/${row.tenant_code}` : `${panels[section][0]}/${row.id}`
    try {
      if (section === 'students') await apiRequest(url, { method: 'DELETE', accessToken: token, tenantCode: campus.tenant_code })
      else await apiRequest(url, { method: 'PATCH', accessToken: token, tenantCode: campus.tenant_code, body: JSON.stringify({ status: section === 'courses' ? 'archived' : section === 'tenants' ? 'suspended' : 'inactive' }) })
      setRows(rows.filter(item => item.id !== row.id))
    } catch (e) { setError(e instanceof Error ? e.message : 'The record could not be removed.') }
  }
  const fields: Record<string, [string, string][]> = {
    tenants: [['tenant_code','Tenant code'],['name','College name'],['slug','URL slug']],
    students: [['registration_number','Registration number'],['first_name','First name'],['last_name','Last name'],['email','Email'],['department','Department'],['semester','Semester']],
    faculty: [['employee_id','Employee ID'],['first_name','First name'],['last_name','Last name'],['email','Email'],['department','Department'],['designation','Designation']],
    courses: [['course_code','Course code'],['title','Course title'],['department','Department'],['credits','Credits'],['semester','Semester'],['description','Description']],
    examinations: [['course_id','Course ID'],['title','Exam title'],['exam_type','Type (midterm/final/quiz/assignment)'],['max_marks','Maximum marks'],['date','Date']],
  }
  const title = section === 'cloud' ? 'Cloud service status' : section[0].toUpperCase() + section.slice(1)
  if (studentPage) return <div className="management-shell">
    <nav className="management-nav" aria-label="Workspace sections">{nav.map(item => <button key={item} className={section === item ? 'selected' : ''} onClick={() => setSection(item)}>{item === 'overview' ? 'Overview' : item[0].toUpperCase()+item.slice(1)}</button>)}</nav>
    <StudentAcademicPanel section={section as 'profile'|'courses'|'attendance'|'examinations'|'documents'} campus={campus} token={token} />
  </div>
  if (adminDataPage) return <div className="management-shell"><nav className="management-nav" aria-label="Workspace sections">{nav.map(item => <button key={item} className={section === item ? 'selected' : ''} onClick={() => setSection(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</nav><AdminDataPanel section={section==='data'?'students':section as 'students'|'faculty'|'courses'} campus={campus} token={token}/></div>
  if (operationalPage) return <div className="management-shell"><nav className="management-nav" aria-label="Workspace sections">{nav.map(item => <button key={item} className={section === item ? 'selected' : ''} onClick={() => setSection(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</nav>{section==='attendance'?<AttendanceManagement role={role} campus={campus} token={token}/>:<ExaminationManagement campus={campus} token={token}/>}</div>
  if (documentsPage) return <div className="management-shell"><nav className="management-nav" aria-label="Workspace sections">{nav.map(item => <button key={item} className={section === item ? 'selected' : ''} onClick={() => setSection(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</nav><DocumentTools token={token} campus={campus} role={role} onChange={()=>window.dispatchEvent(new Event('campuscloud:data-changed'))}/></div>
  if (role==='faculty'&&section==='courses') return <div className="management-shell"><nav className="management-nav" aria-label="Workspace sections">{nav.map(item=><button key={item} className={section===item?'selected':''} onClick={()=>setSection(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</nav><FacultyCoursePanel campus={campus} token={token}/></div>
  return <div className="management-shell">
    <nav className="management-nav" aria-label="Workspace sections">{nav.map(item => <button key={item} className={section === item ? 'selected' : ''} onClick={() => setSection(item)}>{item === 'overview' ? 'Overview' : item[0].toUpperCase()+item.slice(1)}</button>)}</nav>
    {section === 'overview' ? <div className="management-home"><h2>Campus workspace</h2><p>Open a section to manage campus records and view academic activity. All requests use your authenticated role and {campus.tenant_code} tenant scope.</p><div className="management-shortcuts">{nav.filter(item=>item!=='overview').map(item=><button className="secondary-button" key={item} onClick={()=>setSection(item)}>{item[0].toUpperCase()+item.slice(1)} →</button>)}</div></div> : <div className="management-content"><div className="section-heading"><div><h2>{title}</h2><p>Live data from {campus.name} · {campus.tenant_code}</p></div>{busy && <span>Loading…</span>}</div>
      {error && <ErrorMessage>{error}</ErrorMessage>}{notice && <p className="success-message">{notice}</p>}
      {fields[section] && (role === 'college_admin' || (section === 'tenants' && role === 'platform_admin')) && <form className="management-form" onSubmit={event=>void createRecord(event)}><h3>Add {section === 'tenants' ? 'college' : section.slice(0,-1)}</h3><div className="management-fields">{fields[section].map(([name,label])=><label key={name}>{label}<input name={name} type={['semester','credits','max_marks'].includes(name)?'number':name==='date'?'date':'text'} required={!['description','date'].includes(name)} /></label>)}</div><button className="primary-button" type="submit">Save {section === 'tenants' ? 'college' : section.slice(0,-1)}</button></form>}
      {section === 'courses' && role === 'college_admin' && <CourseAssignments token={token} campus={campus} />}
      {section === 'attendance' && (role === 'college_admin' || role === 'faculty') && <AttendanceForm token={token} campus={campus} onSaved={()=>setNotice('Attendance saved. Refresh this section to view updated records.')} />}
      {section === 'examinations' && (role === 'college_admin' || role === 'faculty') && <MarksForm token={token} campus={campus} onSaved={()=>setNotice('Marks saved.')} />}
      {section === 'documents' && <DocumentTools token={token} campus={campus} role={role} onChange={()=>setNotice('Document action completed.')} />}
      {section === 'cloud' && <CloudStatusPanel token={token} campus={campus} />}
      {rows.length > 0 && section !== 'cloud' && <div className="table-scroll"><table><thead><tr>{Object.keys(rows[0]).filter(key=>!['tenant_id','auth_subject','results'].includes(key)).slice(0,8).map(key=><th key={key}>{key.replace(/_/g,' ')}</th>)}{((role==='college_admin'&&['students','faculty','courses'].includes(section))||(role==='platform_admin'&&section==='tenants'))&&<th>Actions</th>}</tr></thead><tbody>{rows.map((row,index)=><tr key={String(row.id ?? index)}>{Object.entries(row).filter(([key])=>!['tenant_id','auth_subject','results'].includes(key)).slice(0,8).map(([key,value])=><td key={key}>{typeof value === 'object' ? '' : String(value ?? '—')}</td>)}{((role==='college_admin'&&['students','faculty','courses'].includes(section))||(role==='platform_admin'&&section==='tenants'))&&<td><button className="table-action" onClick={()=>void updateRow(row)}>Edit</button><button className="table-action" onClick={()=>void archiveRow(row)}>{section==='students'?'Delete':section==='tenants'?'Suspend':'Deactivate'}</button></td>}</tr>)}</tbody></table></div>}
      {!busy && !error && !rows.length && !fields[section] && section!=='documents' && section!=='attendance' && <p className="muted-message">No records to show yet.</p>}
    </div>}</div>
}

function AttendanceForm({token,campus,onSaved}:{token:string;campus:Campus;onSaved:()=>void}) {
  const [courses,setCourses]=useState<Row[]>([]); const [students,setStudents]=useState<Row[]>([]); const [error,setError]=useState('')
  useEffect(()=>{void Promise.all([apiRequest<Row[]>('/courses',{accessToken:token,tenantCode:campus.tenant_code}),apiRequest<Row[]>('/students',{accessToken:token,tenantCode:campus.tenant_code})]).then(([c,s])=>{setCourses(c);setStudents(s)}).catch((e:Error)=>setError(e.message))},[token,campus.tenant_code])
  const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const studentId=String(f.get('student_id'));try{await apiRequest('/attendance/bulk',{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify({course_id:f.get('course_id'),date:f.get('date'),records:[{student_id:studentId,status:f.get('status')}]})});onSaved()}catch(x){setError(x instanceof Error?x.message:'Attendance save failed.')}}
  return <form className="management-form" onSubmit={e=>void submit(e)}><h3>Record attendance</h3>{error&&<ErrorMessage>{error}</ErrorMessage>}<div className="management-fields"><label>Course<select name="course_id" required>{courses.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.course_code)} — {String(c.title)}</option>)}</select></label><label>Student<select name="student_id" required>{students.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.registration_number)} — {String(s.first_name)} {String(s.last_name)}</option>)}</select></label><label>Date<input type="date" name="date" required /></label><label>Status<select name="status"><option>present</option><option>absent</option><option>late</option></select></label></div><button className="primary-button">Save attendance</button></form>
}

function CourseAssignments({token,campus}:{token:string;campus:Campus}) {
  const [courses,setCourses]=useState<Row[]>([]);const [students,setStudents]=useState<Row[]>([]);const [faculty,setFaculty]=useState<Row[]>([]);const [error,setError]=useState('')
  useEffect(()=>{void Promise.all([apiRequest<Row[]>('/courses',{accessToken:token,tenantCode:campus.tenant_code}),apiRequest<Row[]>('/students',{accessToken:token,tenantCode:campus.tenant_code}),apiRequest<Row[]>('/faculty',{accessToken:token,tenantCode:campus.tenant_code})]).then(([c,s,f])=>{setCourses(c);setStudents(s);setFaculty(f)}).catch((e:Error)=>setError(e.message))},[token,campus.tenant_code])
  const send=async(event:FormEvent<HTMLFormElement>,kind:'faculty'|'students')=>{event.preventDefault();setError('');const targetForm=event.currentTarget;const data=new FormData(targetForm);const id=String(data.get('course_id'));const value=String(data.get(kind==='faculty'?'faculty_id':'student_id'));try{await apiRequest(`/courses/${id}/${kind}`,{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify(kind==='faculty'?{faculty_id:value}:{student_id:value})});targetForm.reset()}catch(e){setError(e instanceof Error?e.message:'Could not update course access.')}}
  return <div className="management-form"><h3>Manage course access</h3>{error&&<ErrorMessage>{error}</ErrorMessage>}<div className="management-fields">{(['faculty','students'] as const).map(kind=><form key={kind} onSubmit={event=>void send(event,kind)}><label>Course<select name="course_id" required>{courses.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.course_code)}</option>)}</select></label><label>{kind==='faculty'?'Faculty':'Student'}<select name={kind==='faculty'?'faculty_id':'student_id'} required>{(kind==='faculty'?faculty:students).map(person=><option key={String(person.id)} value={String(person.id)}>{String(person.first_name)} {String(person.last_name)}</option>)}</select></label><button className="secondary-button">{kind==='faculty'?'Assign faculty':'Enroll student'}</button></form>)}</div></div>
}

function MarksForm({token,campus,onSaved}:{token:string;campus:Campus;onSaved:()=>void}) {
  const [exams,setExams]=useState<Row[]>([]);const [students,setStudents]=useState<Row[]>([]);const [error,setError]=useState('')
  useEffect(()=>{void Promise.all([apiRequest<Row[]>('/examinations',{accessToken:token,tenantCode:campus.tenant_code}),apiRequest<Row[]>('/students',{accessToken:token,tenantCode:campus.tenant_code})]).then(([e,s])=>{setExams(e);setStudents(s)}).catch((e:Error)=>setError(e.message))},[token,campus.tenant_code])
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=new FormData(event.currentTarget);const exam=String(form.get('exam_id'));try{await apiRequest(`/examinations/${exam}/results`,{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify({student_id:form.get('student_id'),marks_obtained:Number(form.get('marks_obtained'))})});onSaved()}catch(e){setError(e instanceof Error?e.message:'Marks could not be saved.')}}
  return <form className="management-form" onSubmit={event=>void submit(event)}><h3>Record examination marks</h3>{error&&<ErrorMessage>{error}</ErrorMessage>}<div className="management-fields"><label>Examination<select name="exam_id" required>{exams.map(exam=><option key={String(exam.id)} value={String(exam.id)}>{String(exam.title)}</option>)}</select></label><label>Student<select name="student_id" required>{students.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.registration_number)} · {String(s.first_name)} {String(s.last_name)}</option>)}</select></label><label>Marks<input name="marks_obtained" type="number" min="0" step="0.01" required /></label></div><button className="primary-button">Save marks</button></form>
}

function DocumentTools({token,campus,role,onChange}:{token:string;campus:Campus;role:Role;onChange:()=>void}) {
  const [docs,setDocs]=useState<Row[]>([]);const [courses,setCourses]=useState<Row[]>([]);const [students,setStudents]=useState<Row[]>([]);const [faculty,setFaculty]=useState<Row[]>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [scope,setScope]=useState(role==='faculty'?'course':'college');const [progress,setProgress]=useState(0);const [uploading,setUploading]=useState(false);const [refresh,setRefresh]=useState(0);const [s3Status,setS3Status]=useState<'checking'|'ready'|'not_configured'|'unavailable'>('checking')
  const load=()=>{setLoading(true);setError('');const targets=role==='college_admin'?Promise.all([apiRequest<Row[]>('/courses',{accessToken:token,tenantCode:campus.tenant_code}),apiRequest<Row[]>('/students',{accessToken:token,tenantCode:campus.tenant_code}),apiRequest<Row[]>('/faculty',{accessToken:token,tenantCode:campus.tenant_code})]):apiRequest<Row[]>('/courses',{accessToken:token,tenantCode:campus.tenant_code}).then(c=>[c,[],[]] as [Row[],Row[],Row[]]);return Promise.all([apiRequest<Row[]>('/storage/documents',{accessToken:token,tenantCode:campus.tenant_code}),targets]).then(([d,[c,s,f]])=>{setDocs(d);setCourses(c);setStudents(s);setFaculty(f)}).catch((e:Error)=>setError(e.message)).finally(()=>setLoading(false))}
  useEffect(()=>{void load()},[token,campus.tenant_code,refresh])
  useEffect(()=>{let active=true;apiRequest<{s3_configured:boolean;s3_connectivity:string}>('/info',{accessToken:token,tenantCode:campus.tenant_code}).then(info=>{if(active)setS3Status(!info.s3_configured?'not_configured':info.s3_connectivity==='connected'?'ready':'unavailable')}).catch(()=>{if(active)setS3Status('unavailable')});return()=>{active=false}},[token,campus.tenant_code])
  const upload=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');setProgress(0);setUploading(true);const form=e.currentTarget;const data=new FormData(form);const file=data.get('file') as File;if(!file){setUploading(false);return}const payload:Row={original_filename:file.name,content_type:file.type,file_size:file.size,scope,category:data.get('category')};if(scope==='course')payload.course_id=data.get('target_id');if(scope==='student')payload.student_id=data.get('target_id');if(scope==='faculty')payload.faculty_id=data.get('target_id');try{const response=await apiRequest<{upload:{url:string;fields:Record<string,string>};document:{id:string}}>('/storage/presigned-upload',{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify(payload)});const objectForm=new FormData();Object.entries(response.upload.fields).forEach(([key,value])=>objectForm.append(key,value));objectForm.append('file',file);await new Promise<void>((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',response.upload.url);xhr.upload.onprogress=event=>{if(event.lengthComputable)setProgress(Math.round(event.loaded/event.total*100))};xhr.onerror=()=>reject(new Error('S3 upload request failed. Check the configured bucket CORS and network access.'));xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error(`S3 upload failed (HTTP ${xhr.status}).`));xhr.send(objectForm)});await apiRequest(`/storage/documents/${response.document.id}/complete`,{method:'POST',accessToken:token,tenantCode:campus.tenant_code});form.reset();setScope(role==='faculty'?'course':'college');setProgress(0);onChange();setRefresh(v=>v+1)}catch(cause){setError(cause instanceof Error?cause.message:'Upload could not be completed.')}finally{setUploading(false)}}
  const download=async(id:string)=>{try{const value=await apiRequest<{download_url:string}>(`/storage/presigned-download?document_id=${encodeURIComponent(id)}`,{accessToken:token,tenantCode:campus.tenant_code});window.open(value.download_url,'_blank','noopener,noreferrer')}catch(e){setError(e instanceof Error?e.message:'Download failed.')}}
  const remove=async(id:string)=>{if(!window.confirm('Delete this document from S3 and the campus record?'))return;try{await apiRequest(`/storage/documents/${id}`,{method:'DELETE',accessToken:token,tenantCode:campus.tenant_code});setRefresh(v=>v+1);onChange()}catch(e){setError(e instanceof Error?e.message:'Document deletion failed.')}}
  const options=scope==='course'?courses.map(x=>[String(x.id),`${String(x.course_code)} · ${String(x.title)}`]):scope==='student'?students.map(x=>[String(x.id),`${String(x.registration_number)} · ${String(x.first_name)} ${String(x.last_name)}`]):scope==='faculty'?faculty.map(x=>[String(x.id),`${String(x.employee_id)} · ${String(x.first_name)} ${String(x.last_name)}`]):[]
  return <section className="management-content document-management"><div className="section-heading"><div><h2>Documents</h2><p>Private S3 objects with tenant-scoped PostgreSQL metadata. {role==='faculty'?'Faculty uploads are limited to assigned courses.':''}</p></div><button className="secondary-button refresh-button" onClick={()=>setRefresh(v=>v+1)}>Refresh</button></div>{error&&<ErrorMessage>{error}</ErrorMessage>}
   <form className="management-form" onSubmit={event=>void upload(event)}><h3>Upload document</h3><div className="management-fields">{role==='college_admin'?<label>Document audience<select value={scope} onChange={event=>setScope(event.target.value)}><option value="college">College</option><option value="course">Course</option><option value="student">Student</option><option value="faculty">Faculty member</option></select></label>:<input type="hidden" value="course"/>}{scope!=='college'&&<label>Choose target<select name="target_id" required>{options.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}<label>Category<select name="category"><option value="identity_proof">Identity proof</option><option value="marksheet">Marksheet</option><option value="certificate">Certificate</option><option value="admission">Admission document</option><option value="faculty">Faculty document</option><option value="other">Other</option></select></label><label>File (PDF, JPG, PNG, CSV)<input type="file" name="file" accept="application/pdf,image/jpeg,image/png,text/csv" required/></label></div>{s3Status==='not_configured'&&<p className="storage-s3-message">Private S3 storage is not configured. Set the bucket and region, and give this EC2 instance an IAM role for the bucket.</p>}{s3Status==='unavailable'&&<p className="storage-s3-message">The bucket is configured, but the backend could not verify S3 access. Check the EC2 IAM role and bucket permissions.</p>}{uploading&&<div className="upload-progress" role="status" aria-label={`Upload progress ${progress}%`}><span className="upload-progress-fill" style={{width:`${progress}%`}}/><strong>{progress}%</strong></div>}<button className="primary-button" disabled={uploading||s3Status!=='ready'}>{uploading?`Uploading ${progress}%…`:s3Status==='ready'?'Upload securely':'Upload unavailable'}</button></form>
   {loading?<p className="loading-panel"><span className="loading-spinner"/>Loading authorized documents…</p>:docs.length===0?<EmptyPanel title="No authorized documents yet" detail={settingsCloudMessage(role)}/>:<div className="document-cards">{docs.map(doc=><article className="document-card" key={String(doc.id)}><div className="document-file-icon">{String(doc.content_type).includes('pdf')?'PDF':'FILE'}</div><div className="document-details"><strong>{String(doc.original_filename)}</strong><span>{String(doc.category).replace(/_/g,' ')} · {String(doc.content_type)} · {(Number(doc.file_size)/1024).toFixed(0)} KB</span><small>Uploaded {new Date(String(doc.uploaded_at)).toLocaleDateString()} · {String(doc.scope)} access</small></div><button className="secondary-button" onClick={()=>void download(String(doc.id))}>Download</button>{doc.can_delete===true&&<button className="table-action danger" onClick={()=>void remove(String(doc.id))}>Delete</button>}</article>)}</div>}
  </section>
}

function settingsCloudMessage(role:Role){return role==='college_admin'?'No document metadata has been stored for this tenant. Upload a file above when AWS S3 is configured; local mode will not store documents on disk.':'Your college has not shared any documents authorized for this account.'}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return <article className="stat-card"><span>{label}</span><strong>{value}</strong></article>
}

type AdminKind='students'|'faculty'|'courses'
const csvTemplates:Record<string,string>={
  students:'student_id,name,email,phone,department,semester,enrollment_date\nS1001,Alex Example,alex@example.edu,+1-555-0100,Computer Science,1,2026-09-01\n',
  faculty:'faculty_id,name,email,phone,department,designation\nF1001,Jordan Example,jordan@example.edu,+1-555-0101,Computer Science,Assistant Professor\n',
  courses:'course_code,title,department,semester,credits,description\nCS101,Introduction to Computer Science,Computer Science,1,3,Core course\n',
  attendance:'course_code,student_id,date,status\nCS101,S1001,2026-10-31,present\n',
  marks:'course_code,exam_title,student_id,marks_obtained\nCS101,Mid-Term Examination, S1001,86\n',
}
function downloadText(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();URL.revokeObjectURL(url)}
function csvCell(value:unknown){let text=String(value??'');if(/^[=+@\-]/.test(text))text="'"+text;return `"${text.replace(/"/g,'""')}"`}
function exportRecords(kind:AdminKind,rows:Row[]){const columns=kind==='students'?['registration_number','first_name','last_name','email','phone','department','semester','enrollment_date']:kind==='faculty'?['employee_id','first_name','last_name','email','phone','department','designation']:['course_code','title','department','semester','credits','description'];const content=[columns.join(','),...rows.map(row=>columns.map(key=>csvCell(Array.isArray(row[key])?(row[key] as unknown[]).join('; '):row[key])).join(','))].join('\r\n');downloadText(`${kind}.csv`,content)}

function CSVImportTool({kind,token,campus,onImported}:{kind:AdminKind|'attendance'|'marks';token:string;campus:Campus;onImported:()=>void}){
  const [csv,setCsv]=useState('');const [preview,setPreview]=useState<{valid_rows:{row:number;data:Row}[];errors:{row:number;errors:string[]}[]}|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [result,setResult]=useState('')
  const previewCsv=async()=>{setBusy(true);setError('');setResult('');try{const value=await apiRequest<typeof preview>(`/imports/${kind}/preview`,{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify({csv_text:csv})});setPreview(value)}catch(e){setError(e instanceof Error?e.message:'CSV validation failed.')}finally{setBusy(false)}}
  const commit=async()=>{setBusy(true);setError('');try{const value=await apiRequest<{created_or_updated:number;failed:number;errors:{row:number;errors:string[]}[]}>(`/imports/${kind}/commit`,{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify({csv_text:csv})});setResult(`${value.created_or_updated} records saved; ${value.failed} rows rejected.`);setPreview({valid_rows:[],errors:value.errors});onImported()}catch(e){setError(e instanceof Error?e.message:'Import failed.')}finally{setBusy(false)}}
  return <details className="csv-import"><summary>Import CSV</summary><div className="csv-import-body"><p>Upload CSV for server-side validation. Tenant IDs and roles are never accepted from the file.</p><button className="text-button" type="button" onClick={()=>downloadText(`${kind}-template.csv`,csvTemplates[kind])}>Download CSV template</button><input type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.currentTarget.files?.[0];if(file)setCsv(await file.text())}}/><div className="csv-actions"><button className="secondary-button" type="button" disabled={!csv||busy} onClick={()=>void previewCsv()}>{busy?'Working…':'Validate and preview'}</button>{preview&&preview.valid_rows.length>0&&<button className="primary-button" type="button" disabled={busy} onClick={()=>void commit()}>Confirm import ({preview.valid_rows.length})</button>}</div>{error&&<ErrorMessage>{error}</ErrorMessage>}{result&&<p className="success-message">{result}</p>}{preview&&<><p className="muted-message">{preview.valid_rows.length} valid rows · {preview.errors.length} rows with errors</p>{preview.errors.map(entry=><p className="csv-row-error" key={entry.row}>Row {entry.row}: {entry.errors.join('; ')}</p>)}{preview.valid_rows.slice(0,5).map(entry=><pre className="csv-preview-row" key={entry.row}>Row {entry.row}: {JSON.stringify(entry.data)}</pre>)}</>}</div></details>
}

function AdminDataPanel({section,campus,token}:{section:AdminKind;campus:Campus;token:string}){
  const [rows,setRows]=useState<Row[]>([]);const [search,setSearch]=useState('');const [department,setDepartment]=useState('');const [studentStatus,setStudentStatus]=useState('');const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [editing,setEditing]=useState<Row|null>(null);const [showForm,setShowForm]=useState(false);const [refresh,setRefresh]=useState(0)
  const load=()=>{setLoading(true);setError('');const query=new URLSearchParams();if(search)query.set('search',search);if(department)query.set('department',department);if(section==='students'&&studentStatus)query.set('status',studentStatus);const suffix=query.size?`?${query}`:'';return apiRequest<Row[]>(`/${section}${suffix}`,{accessToken:token,tenantCode:campus.tenant_code}).then(setRows).catch((e:Error)=>setError(e.message)).finally(()=>setLoading(false))}
  useEffect(()=>{const timer=window.setTimeout(()=>{void load()},search?250:0);return()=>window.clearTimeout(timer)},[section,token,campus.tenant_code,search,department,refresh])
  const labels:Record<AdminKind,string>={students:'Students',faculty:'Faculty',courses:'Courses'}
  const fields:Record<AdminKind,[string,string,string?][]>={
    students:[['registration_number','Student ID'],['first_name','First name'],['last_name','Last name'],['email','Email','email'],['phone','Phone'],['department','Department'],['semester','Semester','number'],['enrollment_date','Enrollment date','date']],
    faculty:[['employee_id','Faculty ID'],['first_name','First name'],['last_name','Last name'],['email','Email','email'],['phone','Phone'],['department','Department'],['designation','Designation']],
    courses:[['course_code','Course code'],['title','Course name'],['department','Department'],['semester','Semester','number'],['credits','Credits','number'],['description','Description']],
  }
  const save=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setError('');setNotice('');const form=new FormData(event.currentTarget);const body:Row=Object.fromEntries(form.entries());for(const key of ['semester','credits'])if(body[key])body[key]=Number(body[key]);for(const key of ['phone','enrollment_date'])if(body[key]==='')body[key]=null;try{const id=editing?.id;await apiRequest(id?`/${section}/${id}`:`/${section}`,{method:id?'PATCH':'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify(body)});setShowForm(false);setEditing(null);setNotice(`${labels[section].slice(0,-1)} saved.`);window.dispatchEvent(new Event('campuscloud:data-changed'));setRefresh(v=>v+1)}catch(e){setError(e instanceof Error?e.message:'Could not save record.')}}
  const remove=async(row:Row)=>{if(!row.id||!window.confirm(`Delete ${labels[section].slice(0,-1)} ${section==='students'?row.registration_number:section==='faculty'?row.employee_id:row.course_code}?`))return;try{await apiRequest(`/${section}/${row.id}`,{method:'DELETE',accessToken:token,tenantCode:campus.tenant_code});setNotice('Record deleted.');window.dispatchEvent(new Event('campuscloud:data-changed'));setRefresh(v=>v+1)}catch(e){setError(e instanceof Error?e.message:'Delete failed.')}}
  const archiveCourse=async(row:Row)=>{if(!window.confirm(`Archive ${String(row.course_code)}? Students will no longer see it in active courses.`))return;try{await apiRequest(`/courses/${row.id}`,{method:'PATCH',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify({status:'archived'})});setNotice('Course archived.');window.dispatchEvent(new Event('campuscloud:data-changed'));setRefresh(v=>v+1)}catch(e){setError(e instanceof Error?e.message:'Course could not be archived.')}}
  const columns=section==='students'?['registration_number','first_name','last_name','email','phone','department','semester','status']:section==='faculty'?['employee_id','first_name','last_name','email','phone','department','designation']:['course_code','title','department','semester','credits','faculty_names']
  return <section className="management-content data-management"><div className="section-heading"><div><h2>Data Management · {labels[section]}</h2><p>Records are scoped to {campus.name} ({campus.tenant_code}).</p></div><button className="secondary-button refresh-button" onClick={()=>setRefresh(v=>v+1)} disabled={loading}>{loading?'Loading…':'Refresh'}</button></div>
    <div className="data-actions"><button className="primary-button" onClick={()=>{setEditing(null);setShowForm(true)}}>Add {labels[section].slice(0,-1)}</button><button className="secondary-button" onClick={()=>exportRecords(section,rows)}>Export CSV</button><CSVImportTool kind={section} token={token} campus={campus} onImported={()=>setRefresh(v=>v+1)}/></div>
    <div className="data-filters"><label>Search<input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${labels[section].toLowerCase()}…`}/></label><label>Department<select value={department} onChange={e=>setDepartment(e.target.value)}><option value="">All departments</option>{Array.from(new Set(rows.map(row=>String(row.department??'')).filter(Boolean))).sort().map(value=><option key={value}>{value}</option>)}</select></label>{section==='students'&&<label>Status<select value={studentStatus} onChange={e=>setStudentStatus(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="graduated">Graduated</option></select></label>}</div>
    {error&&<ErrorMessage>{error}</ErrorMessage>}{notice&&<p className="success-message">{notice}</p>}
    {loading?<p className="loading-panel"><span className="loading-spinner"/>Loading {labels[section].toLowerCase()}…</p>:rows.length===0?<EmptyPanel title={`No ${labels[section].toLowerCase()} found`} detail={search||department||studentStatus?'Try changing the search or department filter.':`Add a ${labels[section].slice(0,-1).toLowerCase()} or import a CSV file to get started.`}/>:<div className="table-scroll"><table><thead><tr>{columns.map(col=><th key={col}>{col.replace(/_/g,' ')}</th>)}<th>Actions</th></tr></thead><tbody>{rows.map(row=><tr key={String(row.id)}>{columns.map(col=><td key={col}>{Array.isArray(row[col])?(row[col] as unknown[]).join(', '):String(row[col]??'—')}</td>)}<td className="table-actions"><button className="table-action" onClick={()=>{setEditing(row);setShowForm(true)}}>Edit</button>{section==='courses'&&<button className="table-action" onClick={()=>void archiveCourse(row)}>Archive</button>}<button className="table-action danger" onClick={()=>void remove(row)}>Delete</button></td></tr>)}</tbody></table></div>}
    {section==='courses'&&<CourseRosterManagement campus={campus} token={token}/>}
    {showForm&&<div className="dialog-backdrop"><form className="record-dialog" onSubmit={event=>void save(event)}><div className="section-heading"><h3>{editing?'Edit':'Add'} {labels[section].slice(0,-1)}</h3><button type="button" className="close-dialog" onClick={()=>setShowForm(false)} aria-label="Close">×</button></div>{fields[section].map(([key,label,type])=><label key={key}>{label}<input name={key} type={type??'text'} min={type==='number'?1:undefined} defaultValue={String(editing?.[key]??'')} required={!['phone','enrollment_date'].includes(key)}/></label>)}{error&&<ErrorMessage>{error}</ErrorMessage>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={()=>setShowForm(false)}>Cancel</button><button className="primary-button">Save</button></div></form></div>}
  </section>
}

function CourseRosterManagement({campus,token}:{campus:Campus;token:string}){
 const [courses,setCourses]=useState<Row[]>([]);const [students,setStudents]=useState<Row[]>([]);const [faculty,setFaculty]=useState<Row[]>([]);const [courseId,setCourseId]=useState('');const [roster,setRoster]=useState<Row[]>([]);const [studentId,setStudentId]=useState('');const [facultyId,setFacultyId]=useState('');const [error,setError]=useState('');const [notice,setNotice]=useState('')
 const refreshRoster=async(id=courseId)=>{if(!id){setRoster([]);return}try{setRoster(await apiRequest<Row[]>(`/courses/${id}/students`,{accessToken:token,tenantCode:campus.tenant_code}))}catch(e){setError(e instanceof Error?e.message:'Enrollment list could not load.')}}
 useEffect(()=>{void Promise.all([apiRequest<Row[]>('/courses',{accessToken:token,tenantCode:campus.tenant_code}),apiRequest<Row[]>('/students',{accessToken:token,tenantCode:campus.tenant_code}),apiRequest<Row[]>('/faculty',{accessToken:token,tenantCode:campus.tenant_code})]).then(([c,s,f])=>{setCourses(c);setStudents(s);setFaculty(f);if(c[0])setCourseId(String(c[0].id))}).catch((e:Error)=>setError(e.message))},[token,campus.tenant_code])
 useEffect(()=>{void refreshRoster()},[courseId])
 const request=async(path:string,body:Row)=>{setError('');setNotice('');try{await apiRequest(path,{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify(body)});setNotice('Course access updated.');await refreshRoster()}catch(e){setError(e instanceof Error?e.message:'Could not update course access.')}}
 const unenroll=async(id:string)=>{if(!window.confirm('Remove this student from the course?'))return;try{await apiRequest(`/courses/${courseId}/students/${id}`,{method:'DELETE',accessToken:token,tenantCode:campus.tenant_code});await refreshRoster()}catch(e){setError(e instanceof Error?e.message:'Could not remove enrollment.')}}
 return <div className="management-form course-roster"><h3>Faculty assignment and student enrollment</h3>{error&&<ErrorMessage>{error}</ErrorMessage>}{notice&&<p className="success-message">{notice}</p>}<label>Course<select value={courseId} onChange={e=>setCourseId(e.target.value)}>{courses.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.course_code)} · {String(c.title)}</option>)}</select></label><div className="assignment-row"><label>Assign faculty<select value={facultyId} onChange={e=>setFacultyId(e.target.value)}><option value="">Choose faculty</option>{faculty.map(f=><option key={String(f.id)} value={String(f.id)}>{String(f.employee_id)} · {String(f.first_name)} {String(f.last_name)}</option>)}</select></label><button className="secondary-button" disabled={!facultyId||!courseId} onClick={()=>void request(`/courses/${courseId}/faculty`,{faculty_id:facultyId})}>Assign</button><label>Enroll student<select value={studentId} onChange={e=>setStudentId(e.target.value)}><option value="">Choose student</option>{students.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.registration_number)} · {String(s.first_name)} {String(s.last_name)}</option>)}</select></label><button className="secondary-button" disabled={!studentId||!courseId} onClick={()=>void request(`/courses/${courseId}/students`,{student_id:studentId})}>Enroll</button></div><h4>Enrolled students ({roster.length})</h4>{roster.length===0?<p className="muted-message">No students enrolled in this course.</p>:<div className="enrollment-list">{roster.map(student=><article key={String(student.id)}><span>{String(student.registration_number)} · {String(student.first_name)} {String(student.last_name)}</span><button className="table-action danger" onClick={()=>void unenroll(String(student.id))}>Remove</button></article>)}</div>}</div>
}

function AttendanceManagement({role,campus,token}:{role:Role;campus:Campus;token:string}){
 const [courses,setCourses]=useState<Row[]>([]);const [courseId,setCourseId]=useState('');const [date,setDate]=useState(new Date().toISOString().slice(0,10));const [roster,setRoster]=useState<Row[]>([]);const [history,setHistory]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [refresh,setRefresh]=useState(0)
 const load=async()=>{setLoading(true);setError('');try{const items=await apiRequest<Row[]>('/courses',{accessToken:token,tenantCode:campus.tenant_code});setCourses(items);if(!courseId&&items[0])setCourseId(String(items[0].id))}catch(e){setError(e instanceof Error?e.message:'Assigned courses could not be loaded.')}finally{setLoading(false)}}
 useEffect(()=>{void load()},[token,campus.tenant_code])
 useEffect(()=>{if(!courseId||!date)return;let active=true;setLoading(true);Promise.all([apiRequest<Row[]>(`/attendance/roster?course_id=${encodeURIComponent(courseId)}&date=${encodeURIComponent(date)}`,{accessToken:token,tenantCode:campus.tenant_code}),apiRequest<Row[]>(`/attendance?course_id=${encodeURIComponent(courseId)}`,{accessToken:token,tenantCode:campus.tenant_code})]).then(([r,h])=>{if(active){setRoster(r);setHistory(h)}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Attendance could not be loaded.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[courseId,date,token,campus.tenant_code,refresh])
 const mark=(id:string,status:string)=>setRoster(items=>items.map(item=>item.student_id===id?{...item,status}:item))
 const save=async()=>{setError('');setNotice('');try{await apiRequest('/attendance/bulk',{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify({course_id:courseId,date,records:roster.map(row=>({student_id:row.student_id,status:row.status}))})});setNotice(`Attendance saved for ${roster.length} students on ${date}.`);window.dispatchEvent(new Event('campuscloud:data-changed'));setRefresh(v=>v+1)}catch(e){setError(e instanceof Error?e.message:'Attendance was not saved.')}}
 const studentLabels=new Map(roster.map(row=>[String(row.student_id),`${row.registration_number} · ${row.first_name} ${row.last_name}`]))
 return <section className="management-content"><div className="section-heading"><div><h2>Attendance Entry</h2><p>Record or correct attendance for enrolled students. {role==='faculty'?'Only your assigned courses are available.':''}</p></div><button className="secondary-button refresh-button" onClick={()=>setRefresh(v=>v+1)}>Refresh</button></div>
   {error&&<ErrorMessage>{error}</ErrorMessage>}{notice&&<p className="success-message">{notice}</p>}
   <div className="attendance-controls"><label>Course<select value={courseId} onChange={e=>setCourseId(e.target.value)}><option value="">Choose a course</option>{courses.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.course_code)} · {String(c.title)}</option>)}</select></label><label>Attendance date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="secondary-button" onClick={()=>void setRefresh(v=>v+1)}>Load roster</button><CSVImportTool kind="attendance" token={token} campus={campus} onImported={()=>{setRefresh(v=>v+1);window.dispatchEvent(new Event('campuscloud:data-changed'))}}/></div>
   {loading?<p className="loading-panel"><span className="loading-spinner"/>Loading enrolled students…</p>:!courseId?<EmptyPanel title="Choose a course" detail="Select one of your assigned courses to load its attendance roster."/>:roster.length===0?<EmptyPanel title="No students are enrolled" detail="Enroll students in this course before taking attendance."/>:<><div className="table-scroll"><table><thead><tr><th>Student ID</th><th>Student</th><th>Attendance</th></tr></thead><tbody>{roster.map(student=><tr key={String(student.student_id)}><td>{String(student.registration_number)}</td><td>{String(student.first_name)} {String(student.last_name)}</td><td><select value={String(student.status)} onChange={e=>mark(String(student.student_id),e.target.value)}><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option></select></td></tr>)}</tbody></table></div><button className="primary-button save-attendance" onClick={()=>void save()}>Save attendance ({roster.length})</button></>}
   <h3 className="academic-subheading">Attendance history · {history.length} records</h3>{history.length===0?<p className="muted-message">No attendance history for this course yet.</p>:<div className="enrollment-list">{history.slice(0,20).map(row=><article key={String(row.id)}><span>{String(row.date)} · {studentLabels.get(String(row.student_id))??'Student record'} · {String(row.status)}</span><span>{String(row.status)}</span></article>)}</div>}
 </section>
}

function ExaminationManagement({campus,token}:{campus:Campus;token:string}){
 const [courses,setCourses]=useState<Row[]>([]);const [exams,setExams]=useState<Row[]>([]);const [courseId,setCourseId]=useState('');const [examId,setExamId]=useState('');const [roster,setRoster]=useState<Row[]>([]);const [marks,setMarks]=useState<Record<string,string>>({});const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [refresh,setRefresh]=useState(0)
 const load=async()=>{setLoading(true);setError('');try{const [c,e]=await Promise.all([apiRequest<Row[]>('/courses',{accessToken:token,tenantCode:campus.tenant_code}),apiRequest<Row[]>('/examinations',{accessToken:token,tenantCode:campus.tenant_code})]);setCourses(c);setExams(e);if(!courseId&&c[0])setCourseId(String(c[0].id));if(!examId&&e[0])setExamId(String(e[0].id))}catch(e){setError(e instanceof Error?e.message:'Examinations could not load.')}finally{setLoading(false)}}
 useEffect(()=>{void load()},[token,campus.tenant_code,refresh])
 useEffect(()=>{const exam=exams.find(item=>String(item.id)===examId);if(exam)setCourseId(String(exam.course_id))},[examId,exams])
 useEffect(()=>{if(!examId)return;let active=true;setLoading(true);apiRequest<Row[]>(`/examinations/${examId}/roster`,{accessToken:token,tenantCode:campus.tenant_code}).then(rows=>{if(active){setRoster(rows);setMarks(Object.fromEntries(rows.map(row=>[String(row.student_id),row.marks_obtained==null?'':String(row.marks_obtained)])))}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Examination roster could not load.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[examId,token,campus.tenant_code,refresh])
 const createExam=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const targetForm=event.currentTarget;const form=new FormData(targetForm);setError('');try{const exam=await apiRequest<Row>('/examinations',{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify({course_id:form.get('course_id'),title:form.get('title'),exam_type:form.get('exam_type'),date:form.get('date'),max_marks:Number(form.get('max_marks'))})});setNotice('Examination created.');setExamId(String(exam.id));setRefresh(v=>v+1);window.dispatchEvent(new Event('campuscloud:data-changed'));targetForm.reset()}catch(e){setError(e instanceof Error?e.message:'Examination could not be created.')}}
 const saveMarks=async()=>{const exam=exams.find(item=>String(item.id)===examId);if(!exam)return;setSaving(true);setError('');setNotice('');try{const valid=roster.filter(row=>marks[String(row.student_id)]!=='');for(const row of valid){const value=Number(marks[String(row.student_id)]);if(!Number.isFinite(value)||value<0||value>Number(exam.max_marks))throw new Error(`Marks for ${row.registration_number} must be between 0 and ${exam.max_marks}.`)}await Promise.all(valid.map(row=>apiRequest(`/examinations/${examId}/results`,{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify({student_id:row.student_id,marks_obtained:Number(marks[String(row.student_id)])})})));setNotice(`${valid.length} results saved.`);setRefresh(v=>v+1);window.dispatchEvent(new Event('campuscloud:data-changed'))}catch(e){setError(e instanceof Error?e.message:'Some marks could not be saved.')}finally{setSaving(false)}}
 const csvCourseCode=String(courses.find(c=>String(c.id)===courseId)?.course_code??'');const csvExamTitle=String(exams.find(e=>String(e.id)===examId)?.title??'')
 const enteredScores=roster.map(row=>marks[String(row.student_id)]).filter(value=>value!==''&&Number.isFinite(Number(value))).map(Number)
 const averageScore=enteredScores.length?(enteredScores.reduce((sum,value)=>sum+value,0)/enteredScores.length).toFixed(1):'—'
 return <section className="management-content"><div className="section-heading"><div><h2>Examinations & Marks</h2><p>Create examinations and enter results for enrolled students.</p></div><button className="secondary-button refresh-button" onClick={()=>setRefresh(v=>v+1)}>Refresh</button></div>
   {error&&<ErrorMessage>{error}</ErrorMessage>}{notice&&<p className="success-message">{notice}</p>}
   <form className="management-form exam-create" onSubmit={event=>void createExam(event)}><h3>Schedule examination</h3><div className="management-fields"><label>Course<select name="course_id" required>{courses.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.course_code)} · {String(c.title)}</option>)}</select></label><label>Title<input name="title" required maxLength={200}/></label><label>Type<select name="exam_type"><option value="midterm">Mid-term</option><option value="final">Final</option><option value="quiz">Quiz</option><option value="assignment">Assignment</option></select></label><label>Exam date<input type="date" name="date" required/></label><label>Maximum marks<input name="max_marks" type="number" min="1" defaultValue="100" required/></label></div><button className="primary-button">Create exam</button></form>
   <div className="attendance-controls"><label>Course<select value={courseId} onChange={e=>setCourseId(e.target.value)}>{courses.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.course_code)} · {String(c.title)}</option>)}</select></label><label>Examination<select value={examId} onChange={e=>setExamId(e.target.value)}><option value="">Choose exam</option>{exams.filter(e=>String(e.course_id)===courseId).map(e=><option key={String(e.id)} value={String(e.id)}>{String(e.title)}</option>)}</select></label><CSVImportTool kind="marks" token={token} campus={campus} onImported={()=>{setRefresh(v=>v+1);window.dispatchEvent(new Event('campuscloud:data-changed'))}}/></div>
   {loading?<p className="loading-panel"><span className="loading-spinner"/>Loading enrolled students and marks…</p>:!examId?<EmptyPanel title="No examination selected" detail="Select an examination or create one above to enter marks."/>:roster.length===0?<EmptyPanel title="No students enrolled" detail="Enroll students in the examination course before entering marks."/>:<><div className="exam-summary"><StatCard label="Enrolled students" value={roster.length}/><StatCard label="Marks entered" value={enteredScores.length}/><StatCard label="Current class average" value={averageScore}/></div><p className="muted-message">CSV rows for this result: {csvCourseCode}, {csvExamTitle}, student ID, marks.</p><div className="table-scroll"><table><thead><tr><th>Student ID</th><th>Student</th><th>Marks</th><th>Grade</th></tr></thead><tbody>{roster.map(row=>{const value=marks[String(row.student_id)];const max=Number(exams.find(e=>String(e.id)===examId)?.max_marks??100);const grade=value===''?'—':Number(value)>=90?'S':Number(value)>=80?'A':Number(value)>=70?'B':Number(value)>=60?'C':Number(value)>=50?'D':'F';return <tr key={String(row.student_id)}><td>{String(row.registration_number)}</td><td>{String(row.first_name)} {String(row.last_name)}</td><td><input className="marks-input" type="number" min="0" max={max} step="0.01" value={value} onChange={e=>setMarks(old=>({...old,[String(row.student_id)]:e.target.value}))}/><span> / {max}</span></td><td>{grade}</td></tr>})}</tbody></table></div><button className="primary-button save-attendance" disabled={saving} onClick={()=>void saveMarks()}>{saving?'Saving…':'Save examination marks'}</button></>}
 </section>
}

function FacultyCoursePanel({campus,token}:{campus:Campus;token:string}){
 const [items,setItems]=useState<{course:Row;students:Row[]}[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [refresh,setRefresh]=useState(0)
 useEffect(()=>{let active=true;setLoading(true);apiRequest<Row[]>('/courses',{accessToken:token,tenantCode:campus.tenant_code}).then(async courses=>Promise.all(courses.map(async course=>({course,students:await apiRequest<Row[]>(`/courses/${course.id}/students`,{accessToken:token,tenantCode:campus.tenant_code})})))).then(data=>{if(active)setItems(data)}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Assigned courses could not load.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[token,campus.tenant_code,refresh])
 return <section className="management-content"><div className="section-heading"><div><h2>Assigned Courses</h2><p>Courses and enrolled students for your faculty account.</p></div><button className="secondary-button refresh-button" onClick={()=>setRefresh(v=>v+1)}>Refresh</button></div>{error&&<ErrorMessage>{error}</ErrorMessage>}{loading?<p className="loading-panel"><span className="loading-spinner"/>Loading assigned courses…</p>:items.length===0?<EmptyPanel title="No courses assigned" detail="Your college administrator must assign courses to your faculty account."/>:<div className="academic-course-grid">{items.map(({course,students})=><article className="academic-card" key={String(course.id)}><div className="academic-card-top"><span className="course-code-pill">{String(course.course_code)}</span><span>{String(course.credits)} credits · semester {String(course.semester??'—')}</span></div><h3>{String(course.title)}</h3><p>{String(course.department)}</p><h4>Enrolled students ({students.length})</h4><div className="enrollment-list">{students.map(student=><article key={String(student.id)}><span>{String(student.registration_number)} · {String(student.first_name)} {String(student.last_name)}</span></article>)}</div></article>)}</div>}</section>
}

type AcademicCourse = { id:string; course_code:string; title:string; credits:number; semester:number|null; faculty_names?:string[] }
type StudentProfile = { registration_number:string;first_name:string;last_name:string;email:string;phone:string|null;department:string|null;semester:number|null;enrollment_date:string|null;status:string }
type AcademicAttendance = { id:string; course_id:string; date:string; status:string }
type AcademicExam = { id:string; course_id:string; title:string; exam_type:string; date:string|null; max_marks:number; results?:{marks_obtained:number;grade:string|null}[] }
type AcademicDocument = { id:string; original_filename:string; content_type:string; file_size:number; uploaded_at:string; scope:string }

function StudentAcademicPanel({section,campus,token}:{section:'profile'|'courses'|'attendance'|'examinations'|'documents';campus:Campus;token:string}) {
  const [profile,setProfile]=useState<StudentProfile|null>(null)
  const [courses,setCourses]=useState<AcademicCourse[]>([])
  const [attendance,setAttendance]=useState<AcademicAttendance[]>([])
  const [exams,setExams]=useState<AcademicExam[]>([])
  const [documents,setDocuments]=useState<AcademicDocument[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [refreshKey,setRefreshKey]=useState(0)
  const [selectedCourseId,setSelectedCourseId]=useState('all')
  const [selectedAttendanceStatus,setSelectedAttendanceStatus]=useState('all')
  useEffect(()=>{
    let active=true
    setLoading(true);setError('')
    Promise.all([
      apiRequest<StudentProfile>('/students/me',{accessToken:token,tenantCode:campus.tenant_code}),
      apiRequest<AcademicCourse[]>('/courses',{accessToken:token,tenantCode:campus.tenant_code}),
      apiRequest<AcademicAttendance[]>('/attendance',{accessToken:token,tenantCode:campus.tenant_code}),
      apiRequest<AcademicExam[]>('/examinations',{accessToken:token,tenantCode:campus.tenant_code}),
      apiRequest<AcademicDocument[]>('/storage/documents',{accessToken:token,tenantCode:campus.tenant_code}),
    ]).then(([p,c,a,e,d])=>{if(active){setProfile(p);setCourses(c);setAttendance(a);setExams(e);setDocuments(d)}})
      .catch((cause:Error)=>{if(active)setError(cause.message)})
      .finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[section,token,campus.tenant_code,refreshKey])
  const courseById=new Map(courses.map(course=>[course.id,course]))
  const visibleCourses=selectedCourseId==='all'?courses:courses.filter(course=>course.id===selectedCourseId)
  const courseAttendance=attendance.filter(record=>selectedCourseId==='all'||record.course_id===selectedCourseId)
  const visibleAttendance=courseAttendance.filter(record=>selectedAttendanceStatus==='all'||record.status===selectedAttendanceStatus)
  const present=courseAttendance.filter(record=>record.status==='present').length
  const late=courseAttendance.filter(record=>record.status==='late').length
  const absent=courseAttendance.filter(record=>record.status==='absent').length
  const attendancePercent=courseAttendance.length?Math.round(((present+late)/courseAttendance.length)*100):0
  const today=new Date().toISOString().slice(0,10)
  const upcoming=exams.filter(exam=>exam.date&&exam.date>=today).sort((a,b)=>(a.date??'').localeCompare(b.date??''))
  const completed=exams.filter(exam=>!exam.date||exam.date<today).sort((a,b)=>(b.date??'').localeCompare(a.date??''))
  const download=async(id:string)=>{
    try{const result=await apiRequest<{download_url:string}>(`/storage/presigned-download?document_id=${encodeURIComponent(id)}`,{accessToken:token,tenantCode:campus.tenant_code});window.open(result.download_url,'_blank','noopener,noreferrer')}
    catch(cause){setError(cause instanceof Error?cause.message:'The authorized download could not be prepared.')}
  }
  return <section className="management-content academic-page">
    <div className="section-heading"><div><h2>{section==='examinations'?'Examinations':section[0].toUpperCase()+section.slice(1)}</h2><p>{campus.name} · {campus.tenant_code}</p></div><button className="secondary-button refresh-button" onClick={()=>setRefreshKey(value=>value+1)} disabled={loading}>{loading?'Refreshing…':'Refresh'}</button></div>
    {loading&&<p className="loading-panel" role="status"><span className="loading-spinner"/>Loading your campus records…</p>}
    {error&&<div className="academic-error"><ErrorMessage>{error}</ErrorMessage><button className="secondary-button" onClick={()=>setRefreshKey(value=>value+1)}>Try again</button></div>}
    {!loading&&!error&&section==='profile'&&profile&&<div className="profile-card"><div className="profile-avatar">{profile.first_name.slice(0,1)}{profile.last_name.slice(0,1)}</div><div><h3>{profile.first_name} {profile.last_name}</h3><p>{profile.registration_number} · {profile.department??'Department not set'}</p></div><dl><div><dt>Email</dt><dd>{profile.email}</dd></div><div><dt>Phone</dt><dd>{profile.phone??'Not provided'}</dd></div><div><dt>Semester</dt><dd>{profile.semester??'—'}</dd></div><div><dt>Enrollment date</dt><dd>{profile.enrollment_date??'—'}</dd></div><div><dt>Account status</dt><dd>{profile.status}</dd></div></dl></div>}
    {!loading&&!error&&section==='courses'&&<>
      {courses.length===0?<EmptyPanel title="No courses assigned yet" detail="Your college has not enrolled your student account in courses. Contact your college administrator to complete course enrollment."/>:<><div className="academic-filter-row"><label>Select course<select value={selectedCourseId} onChange={event=>setSelectedCourseId(event.target.value)}><option value="all">All enrolled courses</option>{courses.map(course=><option key={course.id} value={course.id}>{course.course_code} · {course.title}</option>)}</select></label></div><div className="academic-course-grid">{visibleCourses.map(course=><article className="academic-card" key={course.id}><div className="academic-card-top"><span className="course-code-pill">{course.course_code}</span><span>{course.credits} credits</span></div><h3>{course.title}</h3><p>Semester {course.semester??'—'}</p><div className="academic-instructor"><span>Faculty</span><strong>{course.faculty_names?.length?course.faculty_names.join(', '):'Faculty assignment pending'}</strong></div></article>)}</div></>}
    </>}
    {!loading&&!error&&section==='attendance'&&<>
      {attendance.length===0?<EmptyPanel title="No attendance has been recorded" detail="Attendance will appear here after your instructors record it for an enrolled course."/>:<>
        <div className="academic-filter-row"><label>Select course<select value={selectedCourseId} onChange={event=>setSelectedCourseId(event.target.value)}><option value="all">All courses</option>{courses.map(course=><option key={course.id} value={course.id}>{course.course_code} · {course.title}</option>)}</select></label><label>Filter attendance<select value={selectedAttendanceStatus} onChange={event=>setSelectedAttendanceStatus(event.target.value)}><option value="all">All statuses</option><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option></select></label></div>
        <div className="attendance-summary"><article className="attendance-total"><span>{selectedCourseId==='all'?'Overall attendance':'Course attendance'}</span><strong>{attendancePercent}%</strong><div className="attendance-meter"><span style={{width:`${attendancePercent}%`}}/></div><small>{present+late} attended of {courseAttendance.length} recorded sessions. Late counts as attended.</small></article><div className="attendance-count"><StatCard label="Present" value={present}/><StatCard label="Late" value={late}/><StatCard label="Absent" value={absent}/></div></div>
        <h3 className="academic-subheading">By course</h3><div className="academic-course-grid">{visibleCourses.map(course=>{const items=attendance.filter(record=>record.course_id===course.id);if(!items.length)return null;const attended=items.filter(item=>item.status==='present'||item.status==='late').length;const pct=Math.round(attended/items.length*100);return <article className="attendance-course" key={course.id}><div><strong>{course.course_code} · {course.title}</strong><span>{pct}%</span></div><div className="attendance-meter"><span style={{width:`${pct}%`}}/></div><small>{attended} attended of {items.length} recorded sessions</small></article>})}</div>
        <h3 className="academic-subheading">Attendance history</h3>{visibleAttendance.length===0?<EmptyPanel title="No matching attendance" detail="Choose a different course or attendance status to see records."/>:<div className="table-scroll"><table><thead><tr><th>Date</th><th>Course</th><th>Status</th></tr></thead><tbody>{visibleAttendance.map(record=><tr key={record.id}><td>{record.date}</td><td>{courseById.get(record.course_id)?.course_code??'Course'}</td><td><span className={`attendance-status ${record.status}`}>{record.status}</span></td></tr>)}</tbody></table></div>}
      </>}
    </>}
    {!loading&&!error&&section==='examinations'&&<>
      {exams.length===0?<EmptyPanel title="No examinations are scheduled" detail="Your examination schedule and marks will appear here when they are published for your enrolled courses."/>:<>
        <div className="exam-summary"><StatCard label="Upcoming" value={upcoming.length}/><StatCard label="Completed" value={completed.length}/><StatCard label="Results published" value={completed.filter(exam=>exam.results?.length).length}/></div>
        {upcoming.length>0&&<><h3 className="academic-subheading">Upcoming examinations</h3><div className="academic-course-grid">{upcoming.map(exam=><ExamCard key={exam.id} exam={exam} course={courseById.get(exam.course_id)}/>)}</div></>}
        {completed.length>0&&<><h3 className="academic-subheading">Completed examinations & results</h3><div className="academic-course-grid">{completed.map(exam=><ExamCard key={exam.id} exam={exam} course={courseById.get(exam.course_id)}/>)}</div></>}
      </>}
    </>}
    {!loading&&!error&&section==='documents'&&<>
      <StudentDocumentUpload token={token} campus={campus} onUploaded={()=>setRefreshKey(value=>value+1)}/>
      {documents.length===0?<EmptyPanel title="No documents shared with you yet" detail="Files you upload and documents your college authorizes for your account will appear here."/>:<div className="document-cards">{documents.map(document=><article className="document-card" key={document.id}><div className="document-file-icon">{document.content_type.includes('pdf')?'PDF':'FILE'}</div><div className="document-details"><strong>{document.original_filename}</strong><span>{document.content_type} · {(document.file_size/1024).toFixed(0)} KB</span><small>Uploaded {new Date(document.uploaded_at).toLocaleDateString()}</small></div><button className="secondary-button" onClick={()=>void download(document.id)}>Download</button></article>)}</div>}
    </>}
  </section>
}

function StudentDocumentUpload({token,campus,onUploaded}:{token:string;campus:Campus;onUploaded:()=>void}){
  const [s3Status,setS3Status]=useState<'checking'|'ready'|'not_configured'|'unavailable'>('checking')
  const [category,setCategory]=useState('identity_proof')
  const [progress,setProgress]=useState(0)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  useEffect(()=>{let active=true;apiRequest<{s3_configured:boolean;s3_connectivity:string}>('/info',{accessToken:token,tenantCode:campus.tenant_code}).then(info=>{if(active)setS3Status(!info.s3_configured?'not_configured':info.s3_connectivity==='connected'?'ready':'unavailable')}).catch(()=>{if(active)setS3Status('unavailable')});return()=>{active=false}},[token,campus.tenant_code])
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError('');setNotice('');setProgress(0)
    const form=event.currentTarget;const file=new FormData(form).get('file') as File|null
    if(!file||file.size===0){setError('Choose a file to upload.');return}
    setBusy(true)
    try{
      const prepared=await apiRequest<{upload:{url:string;fields:Record<string,string>};document:{id:string}}>('/storage/presigned-upload',{method:'POST',accessToken:token,tenantCode:campus.tenant_code,body:JSON.stringify({original_filename:file.name,content_type:file.type,file_size:file.size,scope:'student',category})})
      const body=new FormData();Object.entries(prepared.upload.fields).forEach(([key,value])=>body.append(key,value));body.append('file',file)
      await new Promise<void>((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',prepared.upload.url);xhr.upload.onprogress=event=>{if(event.lengthComputable)setProgress(Math.round(event.loaded/event.total*100))};xhr.onerror=()=>reject(new Error('The S3 upload request failed. Check the bucket CORS configuration and network access.'));xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error(`S3 upload failed (HTTP ${xhr.status}).`));xhr.send(body)})
      await apiRequest(`/storage/documents/${prepared.document.id}/complete`,{method:'POST',accessToken:token,tenantCode:campus.tenant_code})
      form.reset();setCategory('identity_proof');setProgress(0);setNotice('Document uploaded and added to your account.');onUploaded()
    }catch(cause){setError(cause instanceof Error?cause.message:'The document could not be uploaded.')}
    finally{setBusy(false)}
  }
  return <form className="management-form student-document-upload" onSubmit={event=>void submit(event)}><h3>Upload your document</h3><p>Files are private and attached only to your student account.</p>{error&&<ErrorMessage>{error}</ErrorMessage>}{notice&&<p className="success-message">{notice}</p>}<div className="management-fields"><label>Document type<select value={category} onChange={event=>setCategory(event.target.value)}><option value="identity_proof">Identity proof</option><option value="marksheet">Marksheet</option><option value="certificate">Certificate</option><option value="admission">Admission document</option><option value="other">Other</option></select></label><label>Choose file (PDF, JPG, PNG, CSV)<input type="file" name="file" accept="application/pdf,image/jpeg,image/png,text/csv" required/></label></div>{s3Status==='not_configured'&&<p className="storage-s3-message">Secure S3 storage is not configured, so uploads are unavailable. Configure the bucket, region, and EC2 IAM role.</p>}{s3Status==='unavailable'&&<p className="storage-s3-message">The bucket is configured, but the backend cannot verify S3 access. Ask the administrator to check the EC2 role and bucket permissions.</p>}{busy&&<div className="upload-progress" role="status" aria-label={`Upload progress ${progress}%`}><span className="upload-progress-fill" style={{width:`${progress}%`}}/><strong>{progress}%</strong></div>}<button className="primary-button" disabled={busy||s3Status!=='ready'}>{busy?`Uploading ${progress}%…`:s3Status==='ready'?'Upload document':'Upload unavailable'}</button></form>
}

function EmptyPanel({title,detail}:{title:string;detail:string}){return <div className="academic-empty"><span aria-hidden="true">✦</span><h3>{title}</h3><p>{detail}</p></div>}

function ExamCard({exam,course}:{exam:AcademicExam;course?:AcademicCourse}){
  const result=exam.results?.[0]
  const percent=result?Math.round(result.marks_obtained/exam.max_marks*100):null
  return <article className="academic-card exam-card"><div className="academic-card-top"><span className="course-code-pill">{course?.course_code??'Course'}</span><span>{exam.exam_type}</span></div><h3>{exam.title}</h3><p>{course?.title??'Course details unavailable'}</p><div className="exam-meta"><span>Date<strong>{exam.date??'To be announced'}</strong></span><span>Marks<strong>{result?`${result.marks_obtained} / ${exam.max_marks}`:`— / ${exam.max_marks}`}</strong></span>{percent!==null&&<span>Result<strong>{percent}% · {result?.grade??'—'}</strong></span>}</div></article>
}

type CloudInfo={service:string;version:string;environment:string;runtime:string;aws_region:string;region_configured:boolean;database_type:string;database_target:string;database_connectivity:string;s3_configured:boolean;s3_connectivity:string}
function CloudStatusPanel({token,campus}:{token:string;campus:Campus}){
  const [info,setInfo]=useState<CloudInfo|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [refresh,setRefresh]=useState(0)
  useEffect(()=>{let active=true;setLoading(true);setError('');apiRequest<CloudInfo>('/info',{accessToken:token,tenantCode:campus.tenant_code}).then(value=>{if(active)setInfo(value)}).catch((cause:Error)=>{if(active)setError(cause.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[token,campus.tenant_code,refresh])
  if(loading)return <p className="loading-panel" role="status"><span className="loading-spinner"/>Checking configured services…</p>
  if(error)return <div className="academic-error"><ErrorMessage>{error}</ErrorMessage><button className="secondary-button" onClick={()=>setRefresh(v=>v+1)}>Retry status check</button></div>
  if(!info)return <p className="muted-message">Runtime information is unavailable.</p>
  const statusClass=(value:string)=>value==='connected'?'service-good':value==='unavailable'?'service-bad':'service-neutral'
  return <div className="cloud-status-wrap"><div className="section-heading"><p>Runtime and live dependency checks reported by the backend.</p><button className="secondary-button refresh-button" onClick={()=>setRefresh(v=>v+1)}>Refresh checks</button></div><div className="cloud-status-grid">
    <StatusCard label="Environment" value={info.environment} detail="Application configuration"/>
    <StatusCard label="Runtime" value={info.runtime} detail="ECS is named only when ECS task metadata responds"/>
    <StatusCard label="AWS region" value={info.aws_region} detail={info.region_configured?'Configured; account/resource connectivity is not implied':'No AWS region configured'}/>
    <StatusCard label="Database" value={`${info.database_type} · ${info.database_connectivity}`} detail={`${info.database_target}; connectivity checked with a database ping`} state={statusClass(info.database_connectivity)}/>
    <StatusCard label="Amazon S3" value={info.s3_connectivity} detail={info.s3_configured?'Bucket access verified by HeadBucket when connected':'Bucket or region not configured'} state={statusClass(info.s3_connectivity)}/>
  </div></div>
}
function StatusCard({label,value,detail,state='service-neutral'}:{label:string;value:string;detail:string;state?:string}){return <article className="cloud-status-card"><span>{label}</span><strong className={state}>{value}</strong><small>{detail}</small></article>}

export default App
