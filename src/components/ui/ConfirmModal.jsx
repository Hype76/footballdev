import { useState } from 'react'

export function ConfirmModal({
  cancelLabel = 'Cancel',
  children,
  confirmLabel = 'Confirm',
  confirmDisabled = false,
  hideCancel = false,
  isBusy = false,
  isOpen,
  items = [],
  itemsTitle = 'This will delete:',
  message,
  onCancel,
  onClose,
  onConfirm,
  reasonLabel = 'Reason',
  reasonPlaceholder = '',
  requireReason = false,
  requirePassword = false,
  title = 'Confirm action',
}) {
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)

  const resetFields = () => {
    setPassword('')
    setReason('')
    setIsPasswordVisible(false)
  }

  const handleCancel = () => {
    resetFields()
    onCancel()
  }

  const handleClose = () => {
    const closeAction = onClose || onCancel
    resetFields()
    closeAction()
  }

  const handleConfirm = () => {
    const nextPassword = password
    const nextReason = reason
    resetFields()
    onConfirm(nextPassword, nextReason)
  }

  if (!isOpen) {
    return null
  }
  const hasCompactItems = items.length > 6
  const itemRows = items.map((item) => {
    const itemText = String(item ?? '')
    const separatorIndex = itemText.indexOf(':')

    if (separatorIndex === -1) {
      return {
        key: itemText,
        label: '',
        value: itemText,
      }
    }

    return {
      key: itemText,
      label: itemText.slice(0, separatorIndex).trim(),
      value: itemText.slice(separatorIndex + 1).trim(),
    }
  })
  const cancelDisabledReason = isBusy ? 'Please wait while this action finishes.' : undefined
  const confirmDisabledReason = isBusy
    ? 'Please wait while this action finishes.'
    : confirmDisabled
      ? 'This action is not available yet.'
      : requirePassword && !password.trim()
        ? 'Enter your password before confirming.'
        : requireReason && !reason.trim()
          ? 'Enter a reason before confirming.'
          : undefined
  const isDestructiveAction = /delete|remove|suspend|revoke/i.test(confirmLabel)
  const confirmButtonClass = isDestructiveAction
    ? 'inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-5 py-3 text-sm font-black text-red-700 shadow-sm transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60'
    : 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-[#101828]/45 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-xl shadow-[#047857]/15 sm:p-6"
      >
        <button
          type="button"
          onClick={handleClose}
          disabled={isBusy}
          title={isBusy ? 'Please wait while this action finishes.' : 'Close this window'}
          aria-label="Close this window"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] text-sm font-black text-[#101828] transition hover:border-[#0f9f6e] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          X
        </button>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Please confirm</p>
        <h2 className="mt-3 pr-12 text-2xl font-black tracking-tight text-[#101828]">{title}</h2>
        {message ? <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">{message}</p> : null}
        {items.length > 0 ? (
          <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] p-4 shadow-sm shadow-[#047857]/10">
            <p className="text-sm font-black text-[#101828]">{itemsTitle}</p>
            <ul
              className={
                hasCompactItems
                  ? 'mt-3 grid max-h-52 gap-2 overflow-y-auto overflow-x-hidden pr-1 sm:grid-cols-2'
                  : 'mt-3 space-y-2'
              }
            >
              {itemRows.map((item) => (
                <li key={item.key} className="min-w-0 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2">
                  {item.label ? (
                    <span className="block text-xs font-black uppercase tracking-[0.12em] text-[#4b5f55]">
                      {item.label}
                    </span>
                  ) : null}
                  <span className="mt-1 block min-w-0 break-words text-sm font-semibold leading-6 text-[#4b5f55]">
                    {item.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
        {requireReason ? (
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-black text-[#101828]">{reasonLabel}</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonPlaceholder}
              rows={4}
              className="min-h-28 w-full rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#0f9f6e] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]"
            />
          </label>
        ) : null}
        {requirePassword ? (
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-black text-[#101828]">
              Enter your password to confirm
            </span>
            <div className="flex rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] focus-within:border-[#0f9f6e] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#bbf7d0]">
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="min-h-11 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-[#101828] outline-none"
              />
              <button
                type="button"
                onClick={() => setIsPasswordVisible((current) => !current)}
                className="min-h-11 border-l border-[#d7e5dc] px-4 py-3 text-sm font-black text-[#4b5f55] transition hover:bg-[#d1fae5]"
              >
                {isPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
        ) : null}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          {hideCancel ? null : (
            <button
              type="button"
              onClick={handleCancel}
              disabled={isBusy}
              title={cancelDisabledReason}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isBusy || confirmDisabled || (requirePassword && !password.trim()) || (requireReason && !reason.trim())}
            title={confirmDisabledReason}
            className={confirmButtonClass}
          >
            {isBusy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
