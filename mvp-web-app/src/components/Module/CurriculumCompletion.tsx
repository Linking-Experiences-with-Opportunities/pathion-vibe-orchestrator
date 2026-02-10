import React, { useEffect, useState } from 'react';
import { ShieldCheck, Award, ArrowRight, RefreshCw, LayoutGrid, Zap } from 'lucide-react';
import { useHideNavbar } from '@/contexts/navbar-visibility-context';

export interface CurriculumStats {
  modulesCompleted: number;
  totalModules: number;
  activitiesCompleted: number;
  totalActivities: number;
}

interface ProgramCompletionScreenProps {
  onDismiss: () => void;
  onContinue: () => void;
  stats?: CurriculumStats;
}

const ProgramCompletionScreen: React.FC<ProgramCompletionScreenProps> = ({ onDismiss, onContinue, stats }) => {
  // Derive display values from stats or use defaults
  const modulesCount = stats?.totalModules ?? 4;
  const activitiesCount = stats?.totalActivities ?? 12;
  const masteryPercent = stats && stats.totalActivities > 0 
    ? Math.round((stats.activitiesCompleted / stats.totalActivities) * 100) 
    : 100;
  const [stage, setStage] = useState<'intro' | 'reveal' | 'static'>('intro');
  const [showConfetti, setShowConfetti] = useState(false);

  // Hide navbar while completion screen is shown
  useHideNavbar();

  useEffect(() => {
    const t1 = setTimeout(() => {
      setStage('reveal');
      setShowConfetti(true);
    }, 500);
    const t2 = setTimeout(() => setStage('static'), 3500);
    const t3 = setTimeout(() => setShowConfetti(false), 8000);
    return () => { 
      clearTimeout(t1); 
      clearTimeout(t2); 
      clearTimeout(t3); 
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[200] bg-black flex items-center justify-center overflow-hidden font-sans selection:bg-blue-500/30">
      {/* Background Ambience: Data Constellation */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <svg className="w-full h-full">
          <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#3b82f6" />
          </pattern>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      {/* Radial Gradient Glow */}
      <div className={`absolute inset-0 transition-opacity duration-1000 ${stage !== 'intro' ? 'opacity-100' : 'opacity-0'}`}>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-600/5 blur-[160px] rounded-full" />
      </div>

      {/* Blue Confetti Particles */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none z-0">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-1.5 h-1.5 rounded-sm"
              style={{
                // Using shades of blue and white to maintain the cinematic feel
                backgroundColor: ['#3b82f6', '#60a5fa', '#93c5fd', '#ffffff'][i % 4],
                top: '-20px',
                left: `${Math.random() * 100}%`,
                opacity: Math.random() * 0.8 + 0.2,
                transform: `rotate(${Math.random() * 360}deg)`,
                animation: `fall ${3 + Math.random() * 4}s linear forwards`,
                animationDelay: `${Math.random() * 1.5}s`
              }}
            />
          ))}
        </div>
      )}

      <div className="max-w-2xl w-full px-8 flex flex-col items-center relative z-10 text-center">
        
        {/* Achievement Artifact: The Seal of Mastery */}
        <div className="relative mb-16">
          <div className={`absolute inset-0 bg-blue-500/20 blur-3xl rounded-full transition-all duration-[2000ms] ${stage === 'static' ? 'scale-125 opacity-100' : 'scale-50 opacity-0'}`} />
          
          <svg width="180" height="180" viewBox="0 0 100 100" className="relative drop-shadow-[0_0_15px_rgba(59,130,246,0.3)]">
            {/* Outer Ring */}
            <circle 
              cx="50" cy="50" r="46" 
              fill="none" stroke="#1e1e1e" strokeWidth="1" 
            />
            <circle 
              cx="50" cy="50" r="46" 
              fill="none" stroke="#3b82f6" strokeWidth="2" 
              strokeDasharray="290"
              strokeDashoffset={stage === 'intro' ? 290 : 0}
              className="transition-all duration-[2500ms] ease-out"
            />
            
            {/* Inner Hexagon Frame */}
            <path 
              d="M50 15 L80 32.5 L80 67.5 L50 85 L20 67.5 L20 32.5 Z" 
              fill="none" stroke="#3b82f6" strokeWidth="0.5" strokeOpacity="0.3"
            />
            
            {/* The Badge Icon */}
            <g className={`transition-all duration-[1500ms] delay-1000 ${stage === 'static' ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
              <rect x="35" y="35" width="30" height="30" rx="6" fill="#3b82f6" />
              <text x="50" y="56" textAnchor="middle" fill="white" fontWeight="900" fontSize="22" fontFamily="serif" fontStyle="italic">L</text>
            </g>
          </svg>

          {/* Floating Accents */}
          {['top-0 -left-8', 'bottom-0 -right-8', 'top-10 -right-12'].map((pos, i) => (
             <div key={i} className={`absolute ${pos} transition-all duration-[2000ms] delay-[1500ms] ${stage === 'static' ? 'opacity-40 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                <Zap size={16} className="text-blue-400 fill-blue-400/20" />
             </div>
          ))}
        </div>

        {/* Messaging:restrained & earned */}
        <div className={`space-y-6 transition-all duration-1000 delay-500 ${stage !== 'intro' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.5em] text-zinc-500 mb-4 block">Full Curriculum Mastered</span>
            <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tighter leading-none mb-4">
              The Path is Complete.
            </h1>
            <div className="h-1 w-12 bg-blue-600 mx-auto rounded-full mb-6" />
          </div>

          <p className="text-zinc-400 text-lg leading-relaxed max-w-lg mx-auto font-medium">
            You have successfully navigated the foundational architectures of computer science. From linear arrays to complex graph traversals, your mental model is now complete. 
          </p>
        </div>

        {/* Reflection Stats */}
        <div className={`grid grid-cols-3 gap-12 mt-12 mb-16 transition-all duration-1000 delay-[1200ms] ${stage === 'static' ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
           <div className="text-center">
              <p className="text-white text-xl font-bold">{modulesCount}</p>
              <p className="text-[10px] uppercase font-bold text-zinc-600 tracking-widest mt-1">Modules</p>
           </div>
           <div className="text-center">
              <p className="text-white text-xl font-bold">{activitiesCount}</p>
              <p className="text-[10px] uppercase font-bold text-zinc-600 tracking-widest mt-1">Activities</p>
           </div>
           <div className="text-center">
              <p className="text-white text-xl font-bold">{masteryPercent}%</p>
              <p className="text-[10px] uppercase font-bold text-zinc-600 tracking-widest mt-1">Mastery</p>
           </div>
        </div>

        {/* The Forward Path */}
        <div className={`flex flex-col gap-5 w-full max-w-xs transition-all duration-1000 delay-[1800ms] ${stage === 'static' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          <button
            onClick={onContinue}
            className="w-full bg-white text-black hover:bg-zinc-200 font-bold py-4 px-8 rounded-xl transition-all flex items-center justify-center gap-3 shadow-[0_0_30px_rgba(255,255,255,0.1)] active:scale-[0.98]"
          >
            Claim Your Mock Interview
            <ArrowRight size={18} strokeWidth={3} />
          </button>
          
          <div className="flex items-center gap-3">
            <button
              onClick={onDismiss}
              className="flex-grow bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white font-semibold py-3 px-4 rounded-xl border border-zinc-800 transition-all text-xs flex items-center justify-center gap-2"
            >
              <RefreshCw size={14} />
              Review Curriculum
            </button>
            <button
              onClick={onDismiss}
              className="flex-grow bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white font-semibold py-3 px-4 rounded-xl border border-zinc-800 transition-all text-xs flex items-center justify-center gap-2"
            >
              <LayoutGrid size={14} />
              Dashboard
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fall {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default ProgramCompletionScreen;
