import React, { useEffect, useState } from 'react';
import { Module } from '../types';
import { Trophy, ArrowRight, LayoutGrid, CheckCircle2, Star } from 'lucide-react';
import { useHideNavbar } from '@/contexts/navbar-visibility-context';

interface ModuleCompletionScreenProps {
  module: Module;
  nextModule: Module | null;
  onContinue: () => void;
  onBackToModules: () => void;
}

const ModuleCompletionScreen: React.FC<ModuleCompletionScreenProps> = ({ 
  module, 
  nextModule, 
  onContinue, 
  onBackToModules 
}) => {
  const [showConfetti, setShowConfetti] = useState(false);

  // Hide navbar while completion screen is shown
  useHideNavbar();

  useEffect(() => {
    setShowConfetti(true);
    const timer = setTimeout(() => setShowConfetti(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center overflow-hidden font-sans">
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-gradient-to-b from-blue-600/5 via-transparent to-transparent pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none animate-pulse" />

      {/* Confetti Particles (CSS Only) */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 30 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-sm"
              style={{
                backgroundColor: ['#3b82f6', '#22c55e', '#ffffff', '#60a5fa'][i % 4],
                top: '-20px',
                left: `${Math.random() * 100}%`,
                opacity: Math.random(),
                transform: `rotate(${Math.random() * 360}deg)`,
                animation: `fall ${2 + Math.random() * 3}s linear forwards`,
                animationDelay: `${Math.random() * 2}s`
              }}
            />
          ))}
        </div>
      )}

      <div className="max-w-xl w-full px-6 flex flex-col items-center text-center relative z-10 animate-in fade-in zoom-in-95 duration-700">
        
        {/* Celebration Graphic */}
        <div className="relative mb-10">
           {/* Pulsing Rings */}
           <div className="absolute inset-0 scale-[2.5] bg-blue-500/10 rounded-full animate-ping opacity-20" />
           <div className="absolute inset-0 scale-[1.8] bg-blue-500/20 rounded-full animate-pulse opacity-40" />
           
           <div className="relative w-24 h-24 bg-gradient-to-br from-blue-500 to-blue-700 rounded-3xl flex items-center justify-center shadow-[0_0_50px_rgba(59,130,246,0.5)] rotate-3">
              <Trophy size={48} className="text-white drop-shadow-lg" />
              <div className="absolute -top-2 -right-2 bg-green-500 w-8 h-8 rounded-full flex items-center justify-center border-4 border-background text-background">
                 <CheckCircle2 size={16} strokeWidth={3} />
              </div>
           </div>
        </div>

        {/* Messaging */}
        <div className="space-y-4 mb-12">
           <div className="flex items-center justify-center gap-2 mb-2">
              <div className="h-px w-8 bg-zinc-800" />
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500">Module Mastered</span>
              <div className="h-px w-8 bg-zinc-800" />
           </div>
           <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight">
             {module.title}
           </h1>
           <p className="text-zinc-400 text-lg leading-relaxed max-w-md mx-auto">
             Incredible work! You&apos;ve successfully navigated through all {module.activities.length} lessons and projects in this section.
           </p>
        </div>

        {/* Module Stats Detail */}
        <div className="grid grid-cols-3 gap-6 w-full mb-12 px-4 py-6 bg-zinc-900/40 border border-zinc-800/50 rounded-2xl backdrop-blur-sm">
           <div className="flex flex-col items-center">
              <span className="text-zinc-500 text-[10px] font-bold uppercase mb-1">Status</span>
              <span className="text-green-500 font-bold text-sm">Completed</span>
           </div>
           <div className="flex flex-col items-center border-x border-zinc-800">
              <span className="text-zinc-500 text-[10px] font-bold uppercase mb-1">Progress</span>
              <span className="text-white font-bold text-sm">100%</span>
           </div>
           <div className="flex flex-col items-center">
              <span className="text-zinc-500 text-[10px] font-bold uppercase mb-1">Rating</span>
              <div className="flex text-yellow-500">
                 <Star size={12} fill="currentColor" />
                 <Star size={12} fill="currentColor" />
                 <Star size={12} fill="currentColor" />
              </div>
           </div>
        </div>

        {/* Call to Actions */}
        <div className="flex flex-col w-full gap-4">
          <button
            onClick={onContinue}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-8 rounded-2xl transition-all flex items-center justify-center gap-3 shadow-[0_20px_40px_rgba(59,130,246,0.2)] active:scale-[0.98] group"
          >
            {nextModule ? (
              <>
                Continue to {nextModule.title}
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </>
            ) : (
              "Explore All Modules"
            )}
          </button>
          
          <button
            onClick={onBackToModules}
            className="w-full text-zinc-500 hover:text-white font-semibold py-3 flex items-center justify-center gap-2 transition-colors text-sm"
          >
            <LayoutGrid size={16} />
            Back to Curriculum Overview
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fall {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default ModuleCompletionScreen;
