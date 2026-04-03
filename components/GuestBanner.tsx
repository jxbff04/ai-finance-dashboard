'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMode } from '@/lib/ModeContext';

export default function GuestBanner() {
  const { exitMode } = useMode();
  const [isExiting, setIsExiting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleExit = async () => {
    setIsExiting(true);
    await exitMode();
    setIsExiting(false);
  };

  return (
    <>
      {/* Banner — ultra minimal, single pixel top accent */}
      <div
        style={{
          background: '#111111',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '7px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Pulse dot */}
          <div style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: '#8F7F5A',
            animation: 'bj-pulse-slow 2s ease-in-out infinite',
          }} />
          <p style={{
            fontSize: '9px',
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#8A8A8A',
            fontFamily: 'Inter, sans-serif',
          }}>
            Guest Session · Data cleared on exit
          </p>
        </div>

        <button
          onClick={() => setConfirmOpen(true)}
          style={{
            fontSize: '9px',
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#4A4A4A',
            fontFamily: 'Inter, sans-serif',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            transition: 'color 200ms ease-out',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#8A8A8A'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4A4A4A'; }}
        >
          Exit
        </button>
      </div>

      {/* Confirm dialog */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
        >
          <div style={{
            background: '#111111',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: '28px 24px',
            width: '100%',
            maxWidth: '300px',
          }}>
            {/* Title */}
            <p style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: '22px',
              fontWeight: 400,
              color: '#EFEFEF',
              letterSpacing: '-0.01em',
              marginBottom: '8px',
            }}>
              Exit Guest Session?
            </p>

            {/* Divider */}
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', marginBottom: '16px' }} />

            <p style={{
              fontSize: '12px',
              color: '#8A8A8A',
              fontFamily: 'Inter, sans-serif',
              lineHeight: 1.6,
              marginBottom: '24px',
            }}>
              All data from this session will be{' '}
              <span style={{ color: '#8F6F6F' }}>permanently deleted</span>{' '}
              and cannot be recovered.
            </p>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setConfirmOpen(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#8A8A8A',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase',
                  fontFamily: 'Inter, sans-serif',
                  cursor: 'pointer',
                  transition: 'all 200ms ease-out',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
              >
                Cancel
              </button>
              <button
                onClick={handleExit}
                disabled={isExiting}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#8F6F6F',
                  border: '1px solid transparent',
                  color: '#EFEFEF',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase',
                  fontFamily: 'Inter, sans-serif',
                  cursor: isExiting ? 'not-allowed' : 'pointer',
                  opacity: isExiting ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'opacity 200ms ease-out',
                }}
              >
                {isExiting
                  ? <><Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> Clearing...</>
                  : 'Exit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
