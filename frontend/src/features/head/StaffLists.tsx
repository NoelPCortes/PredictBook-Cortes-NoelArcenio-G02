import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, fieldMessage } from '../../api/client'
import PageControls from '../../components/PageControls'
import RecordField from '../../components/RecordField'
import RecordAlert from '../../components/RecordAlert'
import DeleteConfirmation from '../../components/DeleteConfirmation'
import { useRemoteResource } from '../../components/useRemoteResource'
import { usePendingAction } from '../../components/usePendingAction'
import { getStaffList, revokeStaff } from './api'
import StaffDetailsCard from './StaffDetailsCard'

type Staff = { id: number; username: string; email: string }
type Removal = { email: string; username?: string; isPending: boolean }

export default function StaffLists({ refresh, children }: { refresh: number; children: ReactNode }) {
  const [attempt,setAttempt] = useState(0)
  const [staffPage,setStaffPage] = useState(1)
  const [pendingPage,setPendingPage] = useState(1)
  const [search,setSearch] = useState('')
  const [selected,setSelected] = useState<Staff | null>(null)
  const load = useCallback(() => getStaffList(staffPage,pendingPage,search),[staffPage,pendingPage,search])
  const lists = useRemoteResource(`staff-lists/${refresh}/${attempt}/${staffPage}/${pendingPage}/${search}`,load)
  const [pending,setPending] = useState<Removal | null>(null)
  const { isPending: removing, tryBegin, finish } = usePendingAction()
  const [error,setError] = useState('')
  const [success,setSuccess] = useState('')
  function ask(target: Removal) {setPending(target);setError('');setSuccess('')}
  async function remove() {
    if (!pending || !tryBegin()) return
    setError('');setSuccess('')
    try {
      const result = await revokeStaff(pending.email)
      if (!pending.isPending) setSelected(null)
      setSuccess(result.detail);setPending(null);setAttempt(value => value + 1)
    } catch (error) {
      setError(error instanceof ApiError ? fieldMessage(error.fields.detail) ?? fieldMessage(error.fields.email) ?? fieldMessage(error.fields.non_field_errors) ?? 'Unable to remove Staff access. Please try again.' : 'Unable to remove Staff access. Please try again.')
    } finally {finish()}
  }
  return <div className="head-management-layout">
    <aside className="head-card head-staff-side" aria-label="Staff and pending assignments">
      <RecordField name="head-staff-search" label="Search Staff" value={search} onChange={value => {setSearch(value);setStaffPage(1)}} />
      {!lists.value && !lists.error && <p role="status">Loading Staff and pending assignments...</p>}
      {lists.error && <><RecordAlert kind="error">{lists.error}</RecordAlert><button className="record-button record-secondary" onClick={() => setAttempt(value => value + 1)}>Retry lists</button></>}
      {lists.value && <>
        <section aria-labelledby="head-staff-title"><h2 id="head-staff-title">Staff</h2>
          <ul className="head-staff-list" aria-label="Staff list">{lists.value.staff.map(user => <li key={user.id}><button type="button" className="head-staff-row" aria-pressed={selected?.id === user.id} onClick={() => setSelected(user)}><strong>{user.username}</strong><span>{user.email}</span></button></li>)}</ul>
          {!lists.value.staff.length && <p>{search ? 'No Staff match this search.' : 'No Staff accounts yet.'}</p>}
          <PageControls rows={lists.value.staff} page={staffPage} onChange={setStaffPage} />
        </section>
        <section aria-labelledby="head-pending-title"><h2 id="head-pending-title">Pending assignments</h2>
          <ul className="head-pending-list" aria-label="Pending assignments list">{lists.value.pending.map(row => <li key={row.email}><strong>{row.email}</strong><span>Assigned by {row.assigned_by_username}</span><time dateTime={row.assigned_at}>{new Date(row.assigned_at).toLocaleString('en-US',{timeZone:'UTC'})} UTC</time><button className="record-button record-danger" disabled={removing} onClick={() => ask({email:row.email,isPending:true})}>Remove</button></li>)}</ul>
          {!lists.value.pending.length && <p>No pending assignments.</p>}
          <PageControls rows={lists.value.pending} page={pendingPage} onChange={setPendingPage} />
        </section>
      </>}
    </aside>
    <div className="head-main-panel">
      {children}
      {success && <RecordAlert kind="success">{success}</RecordAlert>}
      {pending && <DeleteConfirmation key={pending.email} message={pending.isPending ? `Remove the pending Staff assignment for ${pending.email}?` : `Remove Staff access for ${pending.username}? They become a Traveler. Their account is not deleted.`} isDeleting={removing} error={error} onCancel={() => {setPending(null);setError('')}} onDelete={() => {void remove()}} actionLabel="Remove" pendingLabel="Removing..." />}
      {selected ? <StaffDetailsCard key={selected.id} id={selected.id} refresh={refresh} isRemoving={removing} onRemove={() => ask({...selected,isPending:false})} /> : <section className="head-card"><p>Select a Staff member to see their details.</p></section>}
    </div>
  </div>
}
