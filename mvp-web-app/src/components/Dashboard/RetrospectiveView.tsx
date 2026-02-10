'use client';

import React, { useState, useEffect } from 'react';
import {
  History,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  BrainCircuit,
  Trophy,
  TriangleAlert,
  Flame,
  Target,
  ShieldCheck,
  TrendingUp,
  BarChart3,
  Lightbulb,
} from 'lucide-react';
import { useDecisionTraceRetrospective, type TimelineEvent } from '@/hooks/useDecisionTraceRetrospective';
import { ExecutionSnapshot } from '@/hooks/useExecutionHistory';
import { TraceTimeline } from '@/components/ProblemPageRevamped/TraceTimeline';
import { MilestoneList } from './MilestoneList';

/** Timeline event shape (re-export for consumers that don't use the hook). */
export type { TimelineEvent };

const MOCK_EVENTS: TimelineEvent[] = [
  { id: '1', time: '00:00', type: 'start', label: 'Session Started', meta: 'Empty state', code: 'class LinkedList:\n    def __init__(self):\n        self.head = None', headline: "Initialization", details: "Session started with the base class definition. No logic implemented yet." },
  { id: '2', time: '05:12', type: 'fail', label: 'Test Failed', meta: 'IndexError', code: 'class LinkedList:\n    def __init__(self):\n        self.head = None\n\n    def add(self, val):\n        self.head.next = Node(val)', headline: "Null Reference Error", details: "Attempted to access .next on self.head before ensuring self.head exists.", proTip: "Always initialize your head node before accessing its attributes." },
  { id: '3', time: '12:45', type: 'progress', label: 'Passed 3/5 Tests', meta: 'Logic update', code: 'class LinkedList:\n    def add(self, val):\n        if not self.head:\n            self.head = Node(val)\n            return\n        curr = self.head\n        while curr.next:\n            curr = curr.next\n        curr.next = Node(val)', headline: "Base Case Handled", details: "Correctly implemented the empty-list check and sequential traversal." },
  { id: '4', time: '18:30', type: 'regression', label: 'REGRESSION: 2/5 Tests', meta: 'Broken Head Logic', code: 'class LinkedList:\n    def add(self, val):\n        # Incorrect head reassignment\n        new_node = Node(val)\n        new_node.next = self.head\n        # self.head = new_node # Reverted from previous correct logic', headline: "Regression Analysis", details: "At this step, you removed the 'if not self.head:' check. This broke the case where the list is empty.", proTip: "Always ensure your base/edge cases (like an empty list) are handled BEFORE implementing the main logic flow." },
  { id: '5', time: '22:00', type: 'struggle', label: 'The Struggle', meta: '15 Min Heatzone', code: 'class LinkedList:\n    # Rapid changes detected in this block\n    def add(self, val):\n        ...', headline: "Implementation Friction", details: "15 minutes of rapid code changes and failing runs centered around pointer reassignment logic." },
  { id: '6', time: '32:15', type: 'success', label: 'Project Completed', meta: '5/5 Passed', code: 'class LinkedList:\n    def __init__(self):\n        self.head = None\n\n    def add(self, val):\n        if not self.head:\n            self.head = Node(val)\n            return\n        curr = self.head\n        while curr.next:\n            curr = curr.next\n        curr.next = Node(val)', headline: "Final Resolution", details: "Logic stabilized with robust head/tail management and O(N) traversal." }
];

const EventNode: React.FC<{ event: TimelineEvent; isActive: boolean; onClick: () => void }> = ({ event, isActive, onClick }) => {
  const getIcon = () => {
    switch (event.type) {
      case 'start': return <div className="w-2 h-2 rounded-full bg-zinc-600" />;
      case 'fail': return <AlertCircle size={14} className="text-rose-500" />;
      case 'progress': return <CheckCircle2 size={14} className="text-emerald-500" />;
      case 'regression': return <TriangleAlert size={14} className="text-amber-500" />;
      case 'struggle': return <Flame size={14} className="text-orange-500" />;
      case 'success': return <Trophy size={14} className="text-yellow-500" />;
    }
  };

  const getBorderColor = () => {
    if (!isActive) return 'border-zinc-800 bg-zinc-950';
    switch (event.type) {
      case 'fail': return 'border-rose-500 bg-rose-500/10 shadow-[0_0_15px_rgba(244,63,94,0.3)]';
      case 'regression': return 'border-amber-500 bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.3)]';
      case 'success': return 'border-yellow-500 bg-yellow-500/10 shadow-[0_0_15px_rgba(234,179,8,0.3)]';
      default: return 'border-blue-500 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.3)]';
    }
  };

  return (
    <div
      className={`relative flex items-center gap-6 group cursor-pointer transition-all duration-300 ${isActive ? 'translate-x-1' : 'hover:translate-x-1'}`}
      onClick={onClick}
    >
      <div className="w-12 text-right">
        <span className={`text-[10px] font-mono font-bold transition-colors ${isActive ? 'text-zinc-100' : 'text-zinc-600'}`}>{event.time}</span>
      </div>

      <div className={`z-10 w-9 h-9 rounded-xl border-2 flex items-center justify-center transition-all duration-500 ${getBorderColor()}`}>
        {getIcon()}
      </div>

      <div className={`flex flex-col transition-opacity ${isActive ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'}`}>
        <h4 className={`text-xs font-bold leading-none mb-1 ${isActive ? 'text-white' : 'text-zinc-400'}`}>{event.label}</h4>
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">{event.meta}</p>
      </div>

      {event.type === 'struggle' && (
        <div className="absolute top-1/2 left-[58px] -translate-y-1/2 w-4 h-24 bg-gradient-to-b from-orange-500/0 via-orange-500/10 to-orange-500/0 pointer-events-none blur-sm" />
      )}
    </div>
  );
};

export interface RetrospectiveViewProps {
  onDone: () => void;
  /** When provided, fetches timeline from GET /decision-trace/session + /timeline (JWT required). */
  contentId?: string;
  contentType?: 'project' | 'problem' | 'module_problem';
  /** Optional execution history to visualize (replaces decision trace if provided) */
  history?: ExecutionSnapshot[];
}

export const RetrospectiveView: React.FC<RetrospectiveViewProps> = ({
  onDone,
  contentId,
  contentType,
  history,
}) => {
  const [viewMode, setViewMode] = useState<'recorder' | 'report'>('recorder');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const {
    events: apiEvents,
    loading: timelineLoading,
    error: timelineError,
    loadEvent,
  } = useDecisionTraceRetrospective(contentId, contentType);

  // State for decision trace mode (must be declared before any conditional returns)
  const useApi = Boolean(contentId && contentType);
  const events = useApi ? apiEvents : MOCK_EVENTS;

  const [activeEvent, setActiveEvent] = useState<TimelineEvent>(MOCK_EVENTS[3]!);
  const [loadedEvent, setLoadedEvent] = useState<TimelineEvent | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(false);

  // Initialize selection when history loads
  useEffect(() => {
    if (history && history.length > 0) {
      setSelectedIndex(history.length - 1);
    }
  }, [history]);

  // Initialize activeEvent when api events load
  useEffect(() => {
    if (!useApi || apiEvents.length === 0) return;
    setActiveEvent(apiEvents[0]!);
    setLoadedEvent(null);
  }, [useApi, apiEvents]);

  // Load event details on selection
  useEffect(() => {
    if (!useApi || apiEvents.length === 0 || !activeEvent.id) return;
    const isFromApi = apiEvents.some((e) => e.id === activeEvent.id);
    if (!isFromApi) return;
    if (loadedEvent?.id === activeEvent.id && loadedEvent.code) return;
    let cancelled = false;
    setLoadingEvent(true);
    loadEvent(activeEvent.id)
      .then((full) => {
        if (!cancelled && full) setLoadedEvent(full);
      })
      .finally(() => {
        if (!cancelled) setLoadingEvent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [useApi, activeEvent.id, apiEvents, loadedEvent?.id, loadedEvent?.code, loadEvent]);

  const handleSelectEvent = async (event: TimelineEvent) => {
    setActiveEvent(event);
    setLoadedEvent(null);
    if (!useApi || !event.id) return;
    if (event.code) {
      setLoadedEvent(event);
      return;
    }
    setLoadingEvent(true);
    try {
      const full = await loadEvent(event.id);
      if (full) setLoadedEvent(full);
    } finally {
      setLoadingEvent(false);
    }
  };

  const displayEvent = loadedEvent ?? activeEvent;

  // -- Mode: Execution History Visualization --
  if (history && history.length > 0) {
    return (
      <div className="fixed inset-0 z-[500] bg-black flex overflow-hidden animate-in fade-in duration-500">
        {/* Left Panel: Milestone List */}
        <div className="w-80 border-r border-zinc-800 flex flex-col bg-[#09090b]">
          <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-900/20 shrink-0">
            <div className="flex items-center gap-2">
              <History size={16} className="text-blue-500" />
              <h2 className="text-xs font-black uppercase tracking-widest text-white">Milestones</h2>
            </div>
            <button onClick={onDone} className="text-[10px] font-bold text-zinc-500 hover:text-white uppercase transition-colors">Close</button>
          </div>

          <div className="flex-grow overflow-y-auto p-4 custom-scrollbar">
            <MilestoneList
              history={history}
              onSelectRun={(idx) => setSelectedIndex(idx)}
            />
          </div>
        </div>

        {/* Right Panel: Trace Timeline & Diffs */}
        <div className="flex-grow flex flex-col bg-[#0d1117] h-full overflow-hidden">
          <TraceTimeline
            history={history}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
        </div>
      </div>
    );
  }

  if (viewMode === 'report') {
    return (
      <div className="fixed inset-0 z-[600] bg-[#09090b] flex flex-col overflow-hidden animate-in fade-in duration-500 font-sans">
        {/* Header */}
        <div className="h-24 border-b border-zinc-800 flex items-center justify-between px-12 bg-zinc-900/10 backdrop-blur-md">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">Project Report Card: <span className="text-blue-500">Linked List Implementation</span></h1>
            <p className="text-xs text-zinc-500 uppercase font-black tracking-widest mt-1">Performance Summary & Future Insights</p>
          </div>
          <button
            onClick={() => setViewMode('recorder')}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl text-xs font-bold text-zinc-300 transition-all"
          >
            <History size={16} />
            Back to Timeline
          </button>
        </div>

        {/* Content Grid */}
        <div className="flex-grow overflow-y-auto p-12 custom-scrollbar">
          <div className="max-w-6xl mx-auto space-y-12">

            {/* 1. Strategic Action Plan */}
            <section>
              <div className="flex items-center gap-3 mb-6">
                <Target size={20} className="text-blue-500" />
                <h2 className="text-sm font-black text-zinc-400 uppercase tracking-[0.2em]">Strategic Action Plan for Next Project</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-blue-600/[0.03] border border-blue-500/20 p-8 rounded-3xl relative overflow-hidden group hover:border-blue-500/40 transition-all">
                  <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                    <BrainCircuit size={48} className="text-blue-400" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-3">Master Pointer Reassignment</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed italic">
                    Your &apos;Struggle&apos; phase showed difficulty with pointer reassignment. <span className="text-blue-400 font-bold block mt-2">For the next project (Trees), sketch out node connections on paper before coding to track parent/child relationships.</span>
                  </p>
                </div>
                <div className="bg-indigo-600/[0.03] border border-indigo-500/20 p-8 rounded-3xl relative overflow-hidden group hover:border-indigo-500/40 transition-all">
                  <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                    <ShieldCheck size={48} className="text-indigo-400" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-3">Edge Case Checklist</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed italic">
                    You had multiple regressions related to edge cases. <span className="text-indigo-400 font-bold block mt-2">Create a checklist of edge cases (e.g., empty input, single item) and test them FIRST before writing your main loop.</span>
                  </p>
                </div>
              </div>
            </section>

            {/* 2. Strengths & Opportunities */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <TrendingUp size={20} className="text-emerald-500" />
                  <h2 className="text-sm font-black text-zinc-400 uppercase tracking-[0.2em]">Key Strengths</h2>
                </div>
                <div className="space-y-4">
                  {["Good use of helper functions", "Clean code structure", "O(N) Traversal optimization"].map((item, i) => (
                    <div key={i} className="flex items-center gap-4 p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-sm font-bold text-zinc-200">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <TrendingUp size={20} className="text-amber-500" />
                  <h2 className="text-sm font-black text-zinc-400 uppercase tracking-[0.2em]">Opportunities</h2>
                </div>
                <div className="space-y-4">
                  {["Improve handling of 'None' values", "Reduce redundant null-checks", "Early exit patterns"].map((item, i) => (
                    <div key={i} className="flex items-center gap-4 p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="text-sm font-bold text-zinc-200">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* 3. Session Metrics */}
            <section>
              <div className="flex items-center gap-3 mb-6">
                <BarChart3 size={20} className="text-zinc-500" />
                <h2 className="text-sm font-black text-zinc-400 uppercase tracking-[0.2em]">Session Metrics</h2>
              </div>
              <div className="grid grid-cols-3 gap-6">
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl text-center">
                  <p className="text-[10px] text-zinc-600 uppercase font-black mb-1">Total Time</p>
                  <p className="text-2xl font-black text-white">32m <span className="text-zinc-700 text-sm">/ 25m Avg</span></p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl text-center">
                  <p className="text-[10px] text-zinc-600 uppercase font-black mb-1">Number of Runs</p>
                  <p className="text-2xl font-black text-white">15</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl text-center">
                  <p className="text-[10px] text-zinc-600 uppercase font-black mb-1">Regressions Fixed</p>
                  <p className="text-2xl font-black text-emerald-500">2</p>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="h-28 border-t border-zinc-800 flex items-center justify-center bg-zinc-900/20 backdrop-blur-md">
          <button
            onClick={onDone}
            className="px-12 py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl transition-all shadow-xl shadow-blue-900/30 active:scale-95 flex items-center gap-3 group"
          >
            Continue to Next Project
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[500] bg-black flex overflow-hidden animate-in fade-in duration-500">
      {/* 1. Timeline Panel */}
      <div className="w-4/12 border-r border-zinc-800 flex flex-col bg-[#09090b]">
        <div className="h-16 border-b border-zinc-800 flex items-center justify-between px-8 bg-zinc-900/20">
          <div className="flex items-center gap-3">
            <History size={18} className="text-blue-500" />
            <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white">Flight Recorder</h2>
          </div>
          <button onClick={onDone} className="text-[10px] font-bold text-zinc-500 hover:text-white uppercase transition-colors">Exit Review</button>
        </div>

        <div className="flex-grow overflow-y-auto p-12 custom-scrollbar relative">
          {useApi && timelineLoading && (
            <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
              Loading timeline…
            </div>
          )}
          {useApi && timelineError && (
            <div className="p-4 mx-4 mt-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              {timelineError}
            </div>
          )}
          {!timelineLoading && (
            <>
              <div className="absolute left-[76px] top-12 bottom-12 w-[2px] bg-zinc-800/50" />
              <div className="space-y-12 relative">
                {events.map((event) => (
                  <EventNode
                    key={event.id}
                    event={event}
                    isActive={activeEvent.id === event.id}
                    onClick={() => handleSelectEvent(event)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Report Card (Dynamic Content based on Active Event) */}
        <div className="p-8 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-6">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors ${displayEvent.type === 'regression' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'}`}>
              {displayEvent.type === 'regression' ? <TriangleAlert size={20} /> : <BrainCircuit size={20} />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{displayEvent.headline || "Session Insight"}</h3>
              <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">{displayEvent.label}</p>
            </div>
          </div>

          {loadingEvent && (
            <div className="mb-4 text-xs text-zinc-500 italic">Loading event details…</div>
          )}
          <div className="space-y-4 mb-8">
            <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-inner">
              <p className="text-xs text-zinc-400 leading-relaxed italic">
                {displayEvent.details || "Scrub through the timeline to analyze specific logic pivots."}
              </p>
            </div>

            {displayEvent.proTip && (
              <div className="p-4 rounded-2xl bg-blue-600/[0.05] border border-blue-500/10">
                <div className="flex items-center gap-2 text-blue-400 mb-1">
                  <Lightbulb size={14} />
                  <span className="text-[9px] font-black uppercase tracking-widest">Actionable Tip</span>
                </div>
                <p className="text-[11px] text-zinc-300 leading-relaxed font-bold">
                  {displayEvent.proTip}
                </p>
              </div>
            )}
          </div>

          <button
            onClick={() => setViewMode('report')}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-900/20 group animate-pulse"
          >
            View Report Card
            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>

      {/* 2. Code Panel */}
      <div className="flex-grow flex flex-col bg-[#0d1117] relative">
        <div className="absolute top-6 right-8 z-50">
          <div className="px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-rose-500" />
            <span className="text-[10px] font-black text-rose-500 uppercase tracking-[0.2em]">Historical View: {displayEvent.time}</span>
          </div>
        </div>

        <div className="h-16 border-b border-zinc-800 flex items-center justify-between px-8 bg-zinc-900/40">
          <div className="flex items-center gap-4">
            <div className="px-3 py-1 bg-zinc-800 rounded-md text-[11px] font-mono text-zinc-400 border border-zinc-700">linkedlist.py</div>
            <div className="h-4 w-px bg-zinc-800" />
            <span className="text-xs font-bold text-zinc-500">READ ONLY MODE</span>
          </div>
        </div>

        <div className="flex-grow p-12 overflow-y-auto custom-scrollbar font-mono text-sm leading-relaxed">
          <div className="max-w-4xl mx-auto">
            {(displayEvent.code || ' ').split('\n').map((line, i) => {
              const isRegressionLine = displayEvent.type === 'regression' && (line.includes('if not self.head') || line.includes('self.head = new_node'));
              return (
                <div key={i} className={`flex group relative ${isRegressionLine ? 'bg-amber-500/5' : ''}`}>
                  <span className="w-12 text-zinc-700 text-right pr-6 select-none italic">{i + 1}</span>
                  <span className={`whitespace-pre transition-colors duration-500 ${isRegressionLine ? 'text-amber-200 font-bold' : 'text-zinc-400'}`}>
                    {line || ' '}
                  </span>
                  {isRegressionLine && (
                    <div className="absolute -left-4 top-0 bottom-0 w-1 bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
