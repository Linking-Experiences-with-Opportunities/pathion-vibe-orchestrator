import React, { useMemo } from 'react';
import { ExecutionSnapshot } from '@/hooks/useExecutionHistory';
import { CheckCircle2, Clock, Trophy } from 'lucide-react';

export interface TestMilestone {
    testName: string;
    passedAt: number;        // Timestamp when it first passed
    timeFromStartMs: number; // How long it took (ms)
    runNumber: number;       // Which run achieved the pass
    snapshotIndex: number;   // Link back to the scrubber
}

export function useTestMilestones(history: ExecutionSnapshot[]) {
    return useMemo(() => {
        if (history.length === 0) return [];

        const milestones: TestMilestone[] = [];
        const passedTests = new Set<string>();

        // Sort history by timestamp just in case, though it should be sorted
        const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);
        const startTime = sortedHistory[0].timestamp;

        sortedHistory.forEach((snapshot, index) => {
            if (!snapshot.success && !snapshot.results) return;

            snapshot.results.forEach(result => {
                if (result.passed && !passedTests.has(result.testName)) {
                    passedTests.add(result.testName);
                    milestones.push({
                        testName: result.testName,
                        passedAt: snapshot.timestamp,
                        timeFromStartMs: snapshot.timestamp - startTime,
                        runNumber: snapshot.runNumber,
                        snapshotIndex: index
                    });
                }
            });
        });

        return milestones;
    }, [history]);
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

interface MilestoneListProps {
    history: ExecutionSnapshot[];
    onSelectRun: (index: number) => void;
}

export function MilestoneList({ history, onSelectRun }: MilestoneListProps) {
    const milestones = useTestMilestones(history);

    if (milestones.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 bg-zinc-900/20 rounded-xl border border-zinc-800/50">
                <Clock className="w-8 h-8 mb-3 opacity-50" />
                <p className="text-sm">No milestones yet.</p>
                <p className="text-xs mt-1">Pass tests to see your progress!</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 px-1">
                <Trophy className="w-4 h-4 text-yellow-500" />
                <h3 className="text-sm font-semibold text-zinc-200">Progress Milestones</h3>
            </div>

            <div className="space-y-2">
                {milestones.map((milestone) => (
                    <button
                        key={milestone.testName}
                        onClick={() => onSelectRun(milestone.snapshotIndex)}
                        className="w-full group flex items-center justify-between p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/50 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all text-left"
                    >
                        <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-full bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20 transition-colors">
                                <CheckCircle2 size={14} />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">
                                    {milestone.testName}
                                </div>
                                <div className="text-xs text-zinc-500 group-hover:text-zinc-400">
                                    Run #{milestone.runNumber}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 bg-zinc-950/50 px-2 py-1 rounded">
                            <Clock size={12} className="text-zinc-600" />
                            {formatDuration(milestone.timeFromStartMs)}
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}
