import { ParentChatWorkspace } from '../components/chat/ParentChatWorkspace.jsx'
import { useAuth } from '../lib/auth.js'

export function ParentChatStaffPage() {
  const { user } = useAuth()

  return (
    <div className="space-y-5">
      <ParentChatWorkspace user={user} variant="staff" />
    </div>
  )
}
