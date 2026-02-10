import { useState, useCallback, useRef } from 'react';

export interface SessionStats {
    syntaxFailures: number;
    syntaxFixTimeMs: number;
    mentalModelMatches: number;
    mentalModelMismatches: number;
}

export interface UseSessionStatsResult {
    stats: SessionStats;
    recordSyntaxFailure: () => void;
    recordSyntaxSuccess: () => void;
    recordMentalModelMatch: () => void;
    recordMentalModelMismatch: () => void;
}

export function useSessionStats(): UseSessionStatsResult {
    const [stats, setStats] = useState<SessionStats>({
        syntaxFailures: 0,
        syntaxFixTimeMs: 0,
        mentalModelMatches: 0,
        mentalModelMismatches: 0,
    });

    const syntaxBrokenAtRef = useRef<number | null>(null);

    const recordSyntaxFailure = useCallback(() => {
        // Only start the timer on the FIRST failure in a sequence
        if (syntaxBrokenAtRef.current === null) {
            syntaxBrokenAtRef.current = Date.now();
        }

        setStats(prev => ({
            ...prev,
            syntaxFailures: prev.syntaxFailures + 1,
        }));
    }, []);

    const recordSyntaxSuccess = useCallback(() => {
        // If we were broken, calculate time to fix
        if (syntaxBrokenAtRef.current !== null) {
            const duration = Date.now() - syntaxBrokenAtRef.current;
            syntaxBrokenAtRef.current = null;

            setStats(prev => ({
                ...prev,
                syntaxFixTimeMs: prev.syntaxFixTimeMs + duration,
            }));
        }
    }, []);

    const recordMentalModelMatch = useCallback(() => {
        setStats(prev => ({
            ...prev,
            mentalModelMatches: prev.mentalModelMatches + 1,
        }));
    }, []);

    const recordMentalModelMismatch = useCallback(() => {
        setStats(prev => ({
            ...prev,
            mentalModelMismatches: prev.mentalModelMismatches + 1,
        }));
    }, []);

    return {
        stats,
        recordSyntaxFailure,
        recordSyntaxSuccess,
        recordMentalModelMatch,
        recordMentalModelMismatch,
    };
}
