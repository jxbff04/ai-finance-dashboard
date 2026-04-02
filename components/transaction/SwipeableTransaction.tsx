'use client';

import { useRef, useState, useCallback } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SwipeableTransactionProps {
  children: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
}

const SWIPE_THRESHOLD = 55;
const LONG_PRESS_DURATION = 500;

export default function SwipeableTransaction({
  children, onEdit, onDelete,
}: SwipeableTransactionProps) {
  const [revealed, setRevealed] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // ── TOUCH ──────────────────────────────────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = false;

    longPressTimer.current = setTimeout(() => {
      if (!isDragging.current) setRevealed(true);
    }, LONG_PRESS_DURATION);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    if (Math.abs(dy) > Math.abs(dx) + 5) {
      clearLongPress();
      return;
    }

    if (Math.abs(dx) > 8) {
      isDragging.current = true;
      clearLongPress();
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    clearLongPress();
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;

    if (isDragging.current) {
      if (dx < -SWIPE_THRESHOLD) setRevealed(true);
      else if (dx > SWIPE_THRESHOLD) setRevealed(false);
    }

    touchStartX.current = null;
    touchStartY.current = null;
    isDragging.current = false;
  }, []);

  // ── MOUSE (desktop long press) ─────────────────────────────────────────────
  const handleMouseDown = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      setRevealed(true);
    }, LONG_PRESS_DURATION);
  }, []);

  const handleMouseUp = useCallback(() => clearLongPress(), []);
  const handleMouseLeave = useCallback(() => clearLongPress(), []);

  return (
    <>
      {/* Overlay untuk close saat klik di luar */}
      {revealed && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setRevealed(false)}
        />
      )}

      <div ref={containerRef} className="relative overflow-hidden">
        {/* Action buttons */}
        <div className={cn(
          'absolute right-0 top-0 bottom-0 flex z-20 transition-all duration-200',
          revealed ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'
        )}>
          <button
            onClick={(e) => { e.stopPropagation(); setRevealed(false); onEdit(); }}
            className="h-full px-4 bg-blue-600 hover:bg-blue-700 text-white flex flex-col items-center justify-center gap-1 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span className="text-[9px] font-bold uppercase tracking-wide">Edit</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setRevealed(false); onDelete(); }}
            className="h-full px-4 bg-red-600 hover:bg-red-700 text-white flex flex-col items-center justify-center gap-1 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="text-[9px] font-bold uppercase tracking-wide">Del</span>
          </button>
        </div>

        {/* Content — geser ke kiri saat revealed */}
        <div
          className={cn(
            'transition-transform duration-200 select-none',
            revealed ? '-translate-x-[104px]' : 'translate-x-0'
          )}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {children}
        </div>
      </div>
    </>
  );
}
