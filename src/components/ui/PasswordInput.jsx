import { useState } from 'react'

export function PasswordInput({ label = 'Password', className = '', ...props }) {
  const [visible, setVisible] = useState(false)
  return <span className="relative block">
    <input {...props} aria-label={props['aria-label'] || label} type={visible ? 'text' : 'password'} className={className} style={{ paddingRight: 80, ...props.style }} />
    <button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} disabled={props.disabled}
      className="absolute inset-y-0 right-1 min-h-11 min-w-16 px-2 text-sm font-bold"
      onClick={() => setVisible((value) => !value)}>{visible ? 'Hide' : 'Show'}</button>
  </span>
}
