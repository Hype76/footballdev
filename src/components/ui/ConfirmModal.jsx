import { useEffect, useState } from 'react'

const overlayClassName = 'fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-[#101828]/45 px-4 py-6'
const panelClassName =
  'relative max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 text-[var(--text-primary)] shadow-xl shadow-[#101828]/10 ring-1 ring-white/70 sm:p-6'
const closeButtonClassName =
  'absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--accent-soft)] text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)] hover:bg-[var(--panel-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60'
const eyebrowClassName = 'text-xs font-black uppercase tracking-[0.18em] text-[var(--text-secondary)]'
const titleClassName = 'mt-3 pr-12 text-2xl font-black tracking-tight text-[var(--text-primary)]'
const messageClassName = 'mt-3 text-sm font-semibold leading-6 text-[var(--text-muted)]'
const itemsPanelClassName =
  'mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] p-4 shadow-sm shadow-[#101828]/5'
const itemTitleClassName = 'text-sm font-black text-[var(--text-primary)]'
const itemRowClassName = 'min-w-0 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2'
const itemLabelClassName = 'block text-xs font-black uppercase tracking-[0.12em] text-[var(--text-secondary)]'
const itemValueClassName = 'mt-1 block min-w-0 break-words text-sm font-semibold leading-6 text-[var(--text-muted)]'
const labelTextClassName = 'mb-2 block text-sm font-black text-[var(--text-primary)]'
const fieldClassName =
  'min-h-28 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:bg-[var(--panel-bg)] focus:ring-2 focus:ring-[var(--accent-soft)]'
const passwordFieldWrapClassName =
  'flex rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] focus-within:border-[var(--accent)] focus-within:bg-[var(--panel-bg)] focus-within:ring-2 focus-within:ring-[var(--accent-soft)]'
const passwordInputClassName =
  'min-h-11 min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none'
const passwordToggleClassName =
  'min-h-11 border-l border-[var(--border-color)] px-4 py-3 text-sm font-black text-[var(--text-muted)] transition hover:bg-[var(--accent-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]'
const errorMessageClassName =
  'mt-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]'
const cancelButtonClassName =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60'
const destructiveConfirmButtonClassName =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-5 py-3 text-sm font-black text-[var(--danger-text)] shadow-sm transition hover:border-[var(--danger-text)] hover:bg-[var(--panel-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--danger-border)] disabled:cursor-not-allowed disabled:opacity-60'
const defaultConfirmButtonClassName =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-black text-[var(--button-primary-text)] shadow-sm shadow-[#101828]/10 transition hover:bg-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60'

export function ConfirmModal({
  cancelLabel = 'Cancel',
  children,
  confirmLabel = 'Confirm',
  confirmDisabled = false,
  errorMessage = '',
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
  const [validationError, setValidationError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const resetFields = () => {
    setPassword('')
    setReason('')
    setIsPasswordVisible(false)
    setValidationError('')
    setIsSubmitting(false)
  }

  useEffect(() => {
    if (!isOpen) {
      setPassword('')
      setReason('')
      setIsPasswordVisible(false)
      setValidationError('')
      setIsSubmitting(false)
    }
  }, [isOpen])

  const handleCancel = () => {
    resetFields()
    onCancel()
  }

  const handleClose = () => {
    const closeAction = onClose || onCancel
    resetFields()
    closeAction()
  }

  const handleConfirm = async (event) => {
    event.preventDefault()

    if (isBusy || isSubmitting || confirmDisabled) {
      return
    }

    const nextPassword = password
    const nextReason = reason

    if (requirePassword && !nextPassword.trim()) {
      setValidationError('Enter your password to confirm this action.')
      return
    }

    if (requireReason && !nextReason.trim()) {
      setValidationError('Enter a reason before confirming.')
      return
    }

    setValidationError('')
    setIsSubmitting(true)

    try {
      await onConfirm(nextPassword, nextReason)
    } catch (error) {
      console.error(error)
      setValidationError(error.message || 'This action could not be completed.')
    } finally {
      setIsSubmitting(false)
    }
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
  const isActionBusy = isBusy || isSubmitting
  const visibleErrorMessage = validationError || errorMessage
  const confirmDisabledReason = isActionBusy
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
    ? destructiveConfirmButtonClassName
    : defaultConfirmButtonClassName

  return (
    <div className={overlayClassName}>
      <div
        role="dialog"
        aria-modal="true"
        className={panelClassName}
      >
        <button
          type="button"
          onClick={handleClose}
          disabled={isBusy}
          title={isBusy ? 'Please wait while this action finishes.' : 'Close this window'}
          aria-label="Close this window"
          className={closeButtonClassName}
        >
          X
        </button>
        <form onSubmit={handleConfirm}>
          <p className={eyebrowClassName}>Please confirm</p>
          <h2 className={titleClassName}>{title}</h2>
          {message ? <p className={messageClassName}>{message}</p> : null}
        {items.length > 0 ? (
          <div className={itemsPanelClassName}>
            <p className={itemTitleClassName}>{itemsTitle}</p>
            <ul
              className={
                hasCompactItems
                  ? 'mt-3 grid max-h-52 gap-2 overflow-y-auto overflow-x-hidden pr-1 sm:grid-cols-2'
                  : 'mt-3 space-y-2'
              }
            >
              {itemRows.map((item) => (
                <li key={item.key} className={itemRowClassName}>
                  {item.label ? (
                    <span className={itemLabelClassName}>
                      {item.label}
                    </span>
                  ) : null}
                  <span className={itemValueClassName}>
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
            <span className={labelTextClassName}>{reasonLabel}</span>
            <textarea
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setValidationError('')
              }}
              placeholder={reasonPlaceholder}
              rows={4}
              className={fieldClassName}
            />
          </label>
        ) : null}
          {requirePassword ? (
          <label className="mt-4 block">
            <span className={labelTextClassName}>
              Enter your password to confirm
            </span>
            <div className={passwordFieldWrapClassName}>
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setValidationError('')
                }}
                autoComplete="current-password"
                className={passwordInputClassName}
              />
              <button
                type="button"
                onClick={() => setIsPasswordVisible((current) => !current)}
                className={passwordToggleClassName}
              >
                {isPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
        ) : null}
          {visibleErrorMessage ? (
            <div className={errorMessageClassName}>
              {visibleErrorMessage}
            </div>
          ) : null}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          {hideCancel ? null : (
            <button
              type="button"
              onClick={handleCancel}
              disabled={isActionBusy}
              title={cancelDisabledReason}
              className={cancelButtonClassName}
            >
              {cancelLabel}
            </button>
          )}
            <button
              type="submit"
              disabled={isActionBusy || confirmDisabled}
              title={confirmDisabledReason}
              className={confirmButtonClass}
            >
              {isActionBusy ? 'Working...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
