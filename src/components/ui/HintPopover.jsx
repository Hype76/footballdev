import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const HINT_POPOVER_OPEN_EVENT = 'football-hint-popover-open'
const EDGE_GAP = 12
const DESKTOP_WIDTH = 360

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function canUseDOM() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export function HintPopover({
  buttonLabel,
  children,
  className = '',
  title,
}) {
  const generatedId = useId()
  const popoverId = `hint-popover-${generatedId.replace(/:/g, '')}`
  const buttonRef = useRef(null)
  const popoverRef = useRef(null)
  const closeTimerRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isClickPinned, setIsClickPinned] = useState(false)
  const [position, setPosition] = useState(null)

  const closePopover = useCallback(() => {
    window.clearTimeout(closeTimerRef.current)
    setIsOpen(false)
    setIsClickPinned(false)
  }, [])

  const openPopover = useCallback((pinned = false) => {
    if (!canUseDOM()) {
      return
    }

    window.clearTimeout(closeTimerRef.current)
    setIsClickPinned(pinned)
    setIsOpen(true)
    window.dispatchEvent(new CustomEvent(HINT_POPOVER_OPEN_EVENT, { detail: popoverId }))
  }, [popoverId])

  const scheduleHoverClose = useCallback(() => {
    if (isClickPinned) {
      return
    }

    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false)
    }, 140)
  }, [isClickPinned])

  const updatePosition = useCallback(() => {
    if (!canUseDOM() || !buttonRef.current) {
      return
    }

    const buttonRect = buttonRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const isMobile = viewportWidth < 640

    if (isMobile) {
      setPosition({
        bottom: EDGE_GAP,
        left: EDGE_GAP,
        maxHeight: Math.max(240, viewportHeight - EDGE_GAP * 2),
        right: EDGE_GAP,
        width: Math.max(280, viewportWidth - EDGE_GAP * 2),
      })
      return
    }

    const width = Math.min(DESKTOP_WIDTH, viewportWidth - EDGE_GAP * 2)
    const measuredHeight = popoverRef.current?.offsetHeight || 420
    const maxHeight = Math.max(260, viewportHeight - EDGE_GAP * 2)
    const height = Math.min(measuredHeight, maxHeight)
    const leftSide = buttonRect.left - width - 10
    const rightSide = buttonRect.right + 10
    const hasRoomOnLeft = leftSide >= EDGE_GAP
    const hasRoomOnRight = rightSide + width <= viewportWidth - EDGE_GAP

    if (hasRoomOnLeft || hasRoomOnRight) {
      setPosition({
        left: hasRoomOnLeft ? leftSide : rightSide,
        maxHeight,
        top: clamp(buttonRect.top - 8, EDGE_GAP, viewportHeight - height - EDGE_GAP),
        width,
      })
      return
    }

    const spaceBelow = viewportHeight - buttonRect.bottom - EDGE_GAP
    const hasRoomBelow = spaceBelow >= Math.min(height, 320)
    const preferredTop = hasRoomBelow
      ? buttonRect.bottom + 8
      : buttonRect.top - height - 8

    setPosition({
      left: clamp(buttonRect.right - width, EDGE_GAP, viewportWidth - width - EDGE_GAP),
      maxHeight,
      top: clamp(preferredTop, EDGE_GAP, viewportHeight - height - EDGE_GAP),
      width,
    })
  }, [])

  useEffect(() => {
    if (!isOpen || !canUseDOM()) {
      return undefined
    }

    updatePosition()
    window.setTimeout(updatePosition, 0)

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePopover()
        buttonRef.current?.focus()
      }
    }

    const handlePointerDown = (event) => {
      if (
        buttonRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      ) {
        return
      }

      closePopover()
    }

    const handleFocusIn = (event) => {
      if (
        buttonRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      ) {
        return
      }

      closePopover()
    }

    const handleOtherPopoverOpen = (event) => {
      if (event.detail !== popoverId) {
        closePopover()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener(HINT_POPOVER_OPEN_EVENT, handleOtherPopoverOpen)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('focusin', handleFocusIn)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener(HINT_POPOVER_OPEN_EVENT, handleOtherPopoverOpen)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [closePopover, isOpen, popoverId, updatePosition])

  useEffect(() => () => {
    window.clearTimeout(closeTimerRef.current)
  }, [])

  const popover = isOpen && canUseDOM() ? createPortal(
    <aside
      ref={popoverRef}
      id={popoverId}
      role="dialog"
      aria-label={title}
      data-score-hint-popover="true"
      onPointerEnter={() => window.clearTimeout(closeTimerRef.current)}
      onPointerLeave={scheduleHoverClose}
      className="fixed z-[120] overflow-y-auto rounded-lg border border-[#9dc9b4] bg-white p-4 text-left text-sm leading-6 text-[#34443b] shadow-2xl shadow-[#101828]/20 outline-none dark:border-[#315244] dark:bg-[#101828] dark:text-[#d7e5dc]"
      style={position || { left: EDGE_GAP, top: EDGE_GAP, width: DESKTOP_WIDTH }}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-base font-black text-[#101828] dark:text-white">{title}</p>
        <button
          type="button"
          onClick={closePopover}
          className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#f7faf8] text-sm font-black text-[#4b5f55] transition hover:border-[#047857] hover:bg-[#ecfdf5] focus:border-[#047857] focus:outline-none focus:ring-2 focus:ring-[#d1fae5] dark:border-[#315244] dark:bg-[#1f2937] dark:text-[#d7e5dc]"
          aria-label={`Close ${title}`}
        >
          X
        </button>
      </div>
      <div className="mt-3">
        {children}
      </div>
    </aside>,
    document.body,
  ) : null

  return (
    <span className={`inline-flex ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={buttonLabel}
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (isOpen && isClickPinned) {
            closePopover()
            return
          }
          openPopover(true)
        }}
        onFocus={() => openPopover(false)}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') {
            openPopover(false)
          }
        }}
        onPointerLeave={scheduleHoverClose}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white text-sm font-black text-[#047857] transition hover:border-[#047857] hover:bg-[#ecfdf5] focus:border-[#047857] focus:outline-none focus:ring-2 focus:ring-[#d1fae5] dark:border-[#315244] dark:bg-[#101828] dark:text-[#8ee6bd]"
      >
        i
      </button>
      {popover}
    </span>
  )
}
