import { useSearchParams } from 'react-router-dom'
import { ParentChatWorkspace } from '../components/chat/ParentChatWorkspace.jsx'
import { useAuth } from '../lib/auth.js'

export function ParentChatStaffPage() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const initialRoomId = String(searchParams.get('roomId') ?? '').trim()

  return (
    <div className="space-y-5">
      <ParentChatWorkspace initialRoomId={initialRoomId} user={user} variant="staff" />
    </div>
  )
}
