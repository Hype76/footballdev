import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { clampFormationCoordinate } from '../../lib/formation-board-editor.js'
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
    <div aria-hidden="true" className="pointer-events-none absolute inset-3 rounded-[1.4rem] border-2 border-white/80">
      <div className="absolute left-0 right-0 top-1/2 border-t-2 border-white/80" />
      <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80" />
      <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80" />
      <div className="absolute left-1/2 top-3 h-[13%] w-[52%] -translate-x-1/2 border-2 border-t-0 border-white/80" />
      <div className="absolute bottom-3 left-1/2 h-[13%] w-[52%] -translate-x-1/2 border-2 border-b-0 border-white/80" />
      <div className="absolute left-1/2 top-3 h-[5%] w-[24%] -translate-x-1/2 border-2 border-t-0 border-white/80" />
      <div className="absolute bottom-3 left-1/2 h-[5%] w-[24%] -translate-x-1/2 border-2 border-b-0 border-white/80" />
    </div>
  )
}

function PlayerMarker({ canEdit, isSelected, marker, onMove, onRemove, onSelect }) {
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
    if (!canEdit || event.button !== 0) {
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

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-label={`${marker.displayName}, ${marker.shirtNumber ? `displayed shirt number ${marker.shirtNumber}` : 'no displayed shirt number'}, ${formatPosition(marker.x)} across, ${formatPosition(marker.y)} down`}
      data-dragging={isDragging ? 'true' : 'false'}
      className={`absolute z-10 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border-[3px] text-center shadow-lg transition motion-reduce:transition-none focus:outline-none focus:ring-4 focus:ring-amber-300 ${isDragging ? 'scale-110 border-sky-200 bg-sky-50 ring-4 ring-sky-300/70' : isSelected ? 'border-amber-300 bg-[#101828]' : 'border-white bg-[#f7faf8]'}`}
      style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
      onClick={() => {
        if (!suppressClickRef.current) onSelect(marker.playerId)
      }}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishPointer}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
    >
      <FormationPlayerMarkerVisual shirtNumber={marker.shirtNumber} className="border-0" />
      <span className="pointer-events-none absolute left-1/2 top-full mt-1 max-w-24 -translate-x-1/2 truncate rounded bg-[#101828]/90 px-1.5 py-0.5 text-[0.65rem] font-black text-white" title={marker.displayName}>
        {marker.displayName}
      </span>
    </button>
  )
}

export const FormationBoardPitch = forwardRef(function FormationBoardPitch({
  canEdit,
  hasPlacementSource,
  onMove,
  onPitchPress,
  onRemove,
  onSelectMarker,
  placements,
  selectedPlayerName,
  selectedMarkerId,
}, ref) {
  const [announcement, setAnnouncement] = useState('')
  const markerIds = useMemo(() => new Set(placements.map((item) => item.playerId)), [placements])

  return (
    <div className="mx-auto w-full max-w-[42rem]">
      <div
        ref={ref}
        data-formation-pitch="true"
        aria-label={hasPlacementSource
          ? `Formation pitch. ${selectedPlayerName || 'Selected Player'} is ready to place. Press Enter to place at the centre, then use the Player marker arrow keys to adjust.`
          : 'Portrait Formation pitch'}
        className="formation-board-pitch relative isolate aspect-[3/4] w-full overflow-hidden rounded-[1.6rem] border-4 border-white bg-[#237a45] shadow-xl shadow-[#101828]/20 focus:outline-none focus:ring-4 focus:ring-amber-300"
        onClick={(event) => {
          if (!canEdit || event.target !== event.currentTarget) return
          onPitchPress(coordinatesFromPointer(event.currentTarget, event.clientX, event.clientY))
        }}
        onKeyDown={(event) => {
          if (!canEdit || !hasPlacementSource || !['Enter', ' '].includes(event.key)) return
          event.preventDefault()
          onPitchPress({ x: 0.5, y: 0.5 })
        }}
        role="group"
        tabIndex={canEdit ? 0 : undefined}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.035)_0,rgba(255,255,255,0.035)_12.5%,rgba(0,0,0,0.035)_12.5%,rgba(0,0,0,0.035)_25%)]" />
        <PitchLines />
        {placements.map((marker) => (
          <PlayerMarker
            key={marker.playerId}
            canEdit={canEdit}
            isSelected={marker.playerId === selectedMarkerId}
            marker={marker}
            onMove={(playerId, coordinates, message) => {
              setAnnouncement(message)
              onMove(playerId, coordinates)
            }}
            onRemove={onRemove}
            onSelect={onSelectMarker}
          />
        ))}
        {markerIds.size === 0 ? (
          <p className="pointer-events-none absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-lg bg-[#101828]/75 px-4 py-3 text-center text-sm font-black text-white">
            Add Players to the Unplaced Players tray, then tap or drag them onto the pitch.
          </p>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  )
})
