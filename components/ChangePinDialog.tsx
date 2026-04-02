'use client';

import { useState } from 'react';
import { Loader2, Delete, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useMode } from '@/lib/ModeContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ChangePinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'old' | 'new' | 'confirm';

const STEP_LABEL: Record<Step, string> = {
  old: 'Enter Current PIN',
  new: 'Enter New PIN',
  confirm: 'Confirm New PIN',
};

export default function ChangePinDialog({ open, onOpenChange }: ChangePinDialogProps) {
  const { changePin } = useMode();
  const [step, setStep] = useState<Step>('old');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [currentInput, setCurrentInput] = useState('');
  const [error, setError] = useState('');

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  const resetAll = () => {
    setStep('old');
    setOldPin('');
    setNewPin('');
    setCurrentInput('');
    setError('');
  };

  const handleClose = () => {
    resetAll();
    onOpenChange(false);
  };

  const handleDigit = (d: string) => {
    if (d === 'del') {
      setCurrentInput(p => p.slice(0, -1));
      setError('');
      return;
    }
    if (currentInput.length >= 6) return;
    setCurrentInput(p => p + d);
    setError('');
  };

  const handleNext = () => {
    if (currentInput.length < 4) {
      setError('PIN minimal 4 digit');
      return;
    }

    if (step === 'old') {
      setOldPin(currentInput);
      setCurrentInput('');
      setStep('new');
    } else if (step === 'new') {
      setNewPin(currentInput);
      setCurrentInput('');
      setStep('confirm');
    } else if (step === 'confirm') {
      if (currentInput !== newPin) {
        setError('PIN tidak cocok. Ulangi.');
        setCurrentInput('');
        return;
      }
      const success = changePin(oldPin, currentInput);
      if (success) {
        toast.success('PIN berhasil diubah!');
        handleClose();
      } else {
        toast.error('PIN lama salah.');
        resetAll();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[320px] bg-[#0a0a0a] border border-gray-800 text-white rounded-none shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif font-black border-b border-gray-800 pb-3 uppercase flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-400" />
            Change PIN
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Step indicator */}
          <div className="flex items-center gap-2 justify-center">
            {(['old', 'new', 'confirm'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={cn(
                  'w-2 h-2 rounded-full transition-all',
                  step === s ? 'bg-white scale-125' : 'bg-gray-700'
                )} />
                {i < 2 && <div className="w-6 h-px bg-gray-800" />}
              </div>
            ))}
          </div>

          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest text-center">
            {STEP_LABEL[step]}
          </p>

          {/* PIN Dots */}
          <div className="flex justify-center gap-3 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={cn(
                'w-3 h-3 rounded-full border-2 transition-all duration-150',
                i < currentInput.length ? 'bg-white border-white' : 'bg-transparent border-gray-600'
              )} />
            ))}
          </div>

          {/* Error */}
          {error && (
            <p className="text-[11px] text-red-400 text-center font-mono animate-pulse">
              {error}
            </p>
          )}

          {/* PIN PAD */}
          <div className="grid grid-cols-3 gap-2">
            {digits.map((d, i) => (
              <button
                key={i}
                onClick={() => d !== '' && handleDigit(d)}
                disabled={d === ''}
                className={cn(
                  'h-12 flex items-center justify-center text-base font-bold transition-all duration-150 border',
                  d === ''
                    ? 'border-transparent cursor-default'
                    : d === 'del'
                    ? 'border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white active:bg-gray-800'
                    : 'border-gray-800 text-white hover:border-gray-500 hover:bg-gray-900 active:bg-gray-800'
                )}
              >
                {d === 'del' ? <Delete className="w-4 h-4" /> : d}
              </button>
            ))}
          </div>

          {/* Next / Submit button */}
          <button
            onClick={handleNext}
            disabled={currentInput.length < 4}
            className="w-full bg-white text-black py-3 font-bold uppercase text-sm tracking-wide hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {step === 'confirm' ? 'Save New PIN' : 'Next →'}
          </button>

          {/* Cancel */}
          <button
            onClick={handleClose}
            className="w-full text-[10px] text-gray-600 hover:text-gray-400 uppercase tracking-widest transition-colors"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
