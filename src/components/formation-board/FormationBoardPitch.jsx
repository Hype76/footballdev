import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { clampFormationCoordinate, getFormationSlotLabel } from '../../lib/formation-board-editor.js'
import { FormationPlayerMarkerVisual } from './FormationPlayerMarkerVisual.jsx'

function coordinatesFromPointer(element, clientX, clientY) {
  const bounds = element.getBoundingClientRect()

  return {
    x: clampFormationCoordinate((clientX - bounds.left) / bounds.width),
    y: clampFormationCoordinate((clientY - bounds.top) / bounds.height),
  }
}

function formatPosition(value) {
  return `${Math.round(Number(value || 0) * 100)} percent`
}

function PitchLines() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.1rem]">
      <div className="absolute inset-x-0 top-1/2 border-t-2 border-white/90" />
      <div className="absolute left-1/2 top-1/2 h-[86px] w-[86px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90" />
      <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />

      <div className="absolute left-1/2 top-0 h-[14%] w-[52%] -translate-x-1/2 border-2 border-t-0 border-white/90" />
      <div className="absolute bottom-0 left-1/2 h-[14%] w-[52%] -translate-x-1/2 border-2 border-b-0 border-white/90" />
      <div className="absolute left-1/2 top-0 h-[6%] w-[24%] -translate-x-1/2 border-2 border-t-0 border-white/90" />
      <div className="absolute bottom-0 left-1/2 h-[6%] w-[24%] -translate-x-1/2 border-2 border-b-0 border-white/90" />

      <div className="absolute left-1/2 top-[14%] h-[35px] w-[70px] -translate-x-1/2 overflow-hidden">
        <div className="absolute -top-[35px] h-[70px] w-[70px] rounded-full border-2 border-white/90" />
      </div>
      <div className="absolute bottom-[14%] left-1/2 h-[35px] w-[70px] -translate-x-1/2 overflow-hidden">
        <div className="absolute top-0 h-[70px] w-[70px] rounded-full border-2 border-white/90" />
      </div>
      <div className="absolute left-1/2 top-[9%] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
      <div className="absolute bottom-[9%] left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-white/90" />

      <div className="absolute -left-3.5 -top-3.5 h-7 w-7 rounded-full border-2 border-white/90" />
      <div className="absolute -right-3.5 -top-3.5 h-7 w-7 rounded-full border-2 border-white/90" />
      <div className="absolute -bottom-3.5 -left-3.5 h-7 w-7 rounded-full border-2 border-white/90" />
      <div className="absolute -bottom-3.5 -right-3.5 h-7 w-7 rounded-full border-2 border-white/90" />
    </div>
  )
}

function PlayerMarker({ canEdit, isSelected, marker, onMove, onRemove, onSelect, selectionMode }) {
  const [livePosition, setLivePosition] = useState(null)
  const dragRef = useRef(null)
  const suppressClickRef = useRef(false)
  const position = livePosition || marker
  const isDragging = Boolean(livePosition)

  useEffect(() => {
    const cancelDrag = () => {
      dragRef.current = null
      setLivePosition(null)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') cancelDrag()
    }
    window.addEventListener('blur', cancelDrag)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('blur', cancelDrag)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const announceAndMove = (x, y) => {
    const next = {
      x: clampFormationCoordinate(x),
      y: clampFormationCoordinate(y),
    }
    onMove(marker.playerId, next, `${marker.displayName} moved to ${formatPosition(next.x)} across and ${formatPosition(next.y)} down.`)
  }

  const handlePointerDown = (event) => {
    if (!canEdit || selectionMode || event.button !== 0) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      moved: false,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
    }
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    if (Math.abs(event.clientX - drag.startClientX) > 4 || Math.abs(event.clientY - drag.startClientY) > 4) {
      drag.moved = true
    }

    if (!drag.moved) {
      return
    }

    event.preventDefault()
    const pitch = event.currentTarget.closest('[data-formation-pitch]')
    if (!pitch) return
    setLivePosition(coordinatesFromPointer(pitch, event.clientX, event.clientY - 24))
  }

  const finishPointer = (event) => {
    const drag = dragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    if (drag.moved && livePosition) {
      suppressClickRef.current = true
      announceAndMove(livePosition.x, livePosition.y)
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }

    dragRef.current = null
    setLivePosition(null)
  }

  const handleKeyDown = (event) => {
    if (!canEdit) {
      return
    }

    if (selectionMode) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onSelect(marker.playerId)
      }
      return
    }

    const step = event.shiftKey ? 0.05 : 0.01
    const changes = {
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
    }

    if (changes[event.key]) {
      event.preventDefault()
      const [deltaX, deltaY] = changes[event.key]
      announceAndMove(marker.x + deltaX, marker.y + deltaY)
      return
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      onRemove(marker.playerId)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setLivePosition(null)
      dragRef.current = null
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(marker.playerId)
    }
  }

  const MarkerElement = canEdit ? 'button' : 'div'

  return (
    <MarkerElement
      type={canEdit ? 'button' : undefined}
      role={canEdit ? undefined : 'img'}
      aria-pressed={canEdit ? isSelected : undefined}
      aria-label={`${marker.displayName}, ${marker.shirtNumber ? `displayed shirt number ${marker.shirtNumber}` : 'no displayed shirt number'}, ${formatPosition(marker.x)} across, ${formatPosition(marker.y)} down${selectionMode ? ', select to move to Bench' : ''}`}
      data-formation-player-marker="true"
      data-dragging={isDragging ? 'true' : 'false'}
      className={`absolute z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 touch-none flex-col items-center justify-center rounded-xl text-center transition motion-reduce:transition-none focus:outline-none focus:ring-4 focus:ring-amber-300 sm:h-[4.5rem] sm:w-[5.25rem] ${isDragging ? 'scale-110 ring-4 ring-sky-300/70' : isSelected ? 'bg-[#061b13]/50 ring-2 ring-amber-300' : ''}`}
      style={{ left: `clamp(3.25rem, ${position.x * 100}%, calc(100% - 3.25rem))`, top: `clamp(3.25rem, ${position.y * 100}%, calc(100% - 3.25rem))` }}
      onClick={() => {
        if (!suppressClickRef.current) onSelect(marker.playerId)
      }}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishPointer}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
    >
      <FormationPlayerMarkerVisual isGoalkeeper={marker.positionGroup === 'goalkeeper'} shirtNumber={marker.shirtNumber} />
      <span className="pointer-events-none -mt-2 max-w-24 truncate rounded-md bg-[#03150e]/90 px-2 py-0.5 text-[0.66rem] font-black text-white shadow" title={marker.displayName}>
        {marker.displayName}
      </span>
    </MarkerElement>
  )
}

export const FormationBoardPitch = forwardRef(function FormationBoardPitch({
  canEdit,
  hasPlacementSource,
  onMove,
  onPitchPress,
  onRemove,
  onSelectMarker,
  onSelectSlot,
  placements,
  selectedPlayerName,
  selectedMarkerId,
  selectedMarkerIds = [],
  selectionMode = false,
  slots = [],
}, ref) {
  const [announcement, setAnnouncement] = useState('')
  const markerIds = useMemo(() => new Set(placements.map((item) => item.playerId)), [placements])
  const selectedIds = useMemo(() => new Set(selectedMarkerIds), [selectedMarkerIds])
  const occupiedSlotIds = useMemo(() => new Set(placements.map((item) => item.slotId).filter(Boolean)), [placements])
  const fixedSlots = useMemo(() => (Array.isArray(slots) ? slots.filter((slot) => slot?.id) : []), [slots])

  return (
    <div className="mx-auto w-full max-w-[43rem] lg:max-w-[min(43rem,max(22rem,calc(69dvh-13.11rem)))]">
      {fixedSlots.length > 0 && canEdit && !selectionMode ? (
        <p className="sr-only">
          Tap a position to add or swap a Player.
        </p>
      ) : null}
      <div
        ref={ref}
        data-formation-pitch="true"
        aria-label={hasPlacementSource
          ? `Formation pitch. ${selectedPlayerName || 'Selected Player'} is ready to place. Press Enter to place at the centre, then use the Player marker arrow keys to adjust.`
          : 'Portrait Formation pitch'}
        className="formation-board-pitch relative isolate aspect-[3/4] w-full overflow-hidden rounded-[1.35rem] border-[3px] border-white bg-[#0a6c2f] shadow-2xl shadow-black/30 focus:outline-none focus:ring-4 focus:ring-amber-300"
        onClick={(event) => {
          if (!canEdit || selectionMode || event.target !== event.currentTarget) return
          onPitchPress(coordinatesFromPointer(event.currentTarget, event.clientX, event.clientY))
        }}
        onKeyDown={(event) => {
          if (!canEdit || selectionMode || !hasPlacementSource || !['Enter', ' '].includes(event.key)) return
          event.preventDefault()
          onPitchPress({ x: 0.5, y: 0.5 })
        }}
        role="group"
        tabIndex={canEdit ? 0 : undefined}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(180deg,rgba(255,255,255,0.055)_0,rgba(255,255,255,0.055)_12.5%,rgba(0,0,0,0.075)_12.5%,rgba(0,0,0,0.075)_25%)]" />
        <PitchLines />
        {fixedSlots.map((slot) => {
          if (occupiedSlotIds.has(slot.id)) return null
          const label = getFormationSlotLabel(slot)

          return (
            <button
              key={slot.id}
              type="button"
              disabled={!canEdit || selectionMode}
              aria-label={`${label}, empty. Add Player.`}
              onClick={(event) => {
                event.stopPropagation()
                onSelectSlot(slot.id)
              }}
              className="absolute z-[5] flex min-h-12 min-w-12 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 border-dashed border-white bg-[#101828]/70 px-1.5 text-center text-white shadow-md transition hover:border-amber-300 hover:bg-[#101828] focus:outline-none focus:ring-4 focus:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-70"
              style={{ left: `clamp(3rem, ${Number(slot.x) * 100}%, calc(100% - 3rem))`, top: `clamp(3rem, ${Number(slot.y) * 100}%, calc(100% - 3rem))` }}
            >
              <span className="text-[0.7rem] font-black leading-none">Add</span>
              <span className="pointer-events-none absolute left-1/2 top-full mt-1 max-w-24 -translate-x-1/2 truncate rounded bg-[#101828]/90 px-1.5 py-0.5 text-[0.56rem] font-black text-white" title={label}>{label}</span>
            </button>
          )
        })}
        {placements.map((marker) => (
          <PlayerMarker
            key={marker.playerId}
            canEdit={canEdit}
            isSelected={selectionMode ? selectedIds.has(marker.playerId) : marker.playerId === selectedMarkerId}
            marker={marker}
            onMove={(playerId, coordinates, message) => {
              setAnnouncement(message)
              onMove(playerId, coordinates)
            }}
            onRemove={onRemove}
            onSelect={onSelectMarker}
            selectionMode={selectionMode}
          />
        ))}
        {markerIds.size === 0 && fixedSlots.length === 0 ? (
          <p className="pointer-events-none absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-lg bg-[#101828]/75 px-4 py-3 text-center text-sm font-black text-white">
            Add Players to the Bench, then tap or drag them onto the pitch.
          </p>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  )
})
