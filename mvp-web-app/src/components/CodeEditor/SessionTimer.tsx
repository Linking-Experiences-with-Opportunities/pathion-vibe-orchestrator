
import React, { useState, useEffect } from 'react';
import { Timer, Pause, Play } from 'lucide-react';

const SessionTimer: React.FC = () => {
    const [seconds, setSeconds] = useState(0);
    const [isActive, setIsActive] = useState(true);

    useEffect(() => {
        let interval: number | null = null;
        if (isActive) {
            interval = window.setInterval(() => {
                setSeconds((seconds) => seconds + 1);
            }, 1000);
        } else if (!isActive && seconds !== 0) {
            if (interval) clearInterval(interval);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isActive, seconds]);

    const formatTime = (totalSeconds: number) => {
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex items-center gap-3 bg-zinc-800/50 border border-zinc-700/50 px-3 py-1.5 rounded-lg shadow-inner">
            <div className="flex items-center gap-2">
                <Timer size={14} className={isActive ? "text-blue-400 animate-pulse" : "text-zinc-500"} />
                <span className="text-sm font-mono font-bold text-zinc-200 w-12 text-center">
                    {formatTime(seconds)}
                </span>
            </div>
            <div className="h-4 w-px bg-zinc-700" />
            <button
                onClick={() => setIsActive(!isActive)}
                className="text-zinc-500 hover:text-white transition-colors p-0.5 rounded"
                title={isActive ? "Pause Session" : "Resume Session"}
            >
                {isActive ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
            </button>
        </div>
    );
};

export default SessionTimer;
