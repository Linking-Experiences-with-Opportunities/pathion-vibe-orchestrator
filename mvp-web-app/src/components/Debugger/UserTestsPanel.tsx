import React from 'react';
import { Icons } from './Icon';

interface UserTestsPanelProps {
  onGoToEditor: () => void;
}

export const UserTestsPanel: React.FC<UserTestsPanelProps> = ({ onGoToEditor }) => {
  return (
    <div className="h-full flex flex-col bg-gray-950 overflow-y-auto">
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-lg mx-auto">
        <div className="w-16 h-16 bg-gray-900 border border-gray-800 rounded-2xl flex items-center justify-center mb-6 shadow-xl">
          <Icons.Pencil className="w-8 h-8 text-gray-400" />
        </div>

        <h2 className="text-xl font-bold text-gray-100 mb-2 tracking-tight">
          No User Tests Run Yet
        </h2>
        
        <p className="text-gray-500 text-sm leading-relaxed mb-8">
          Verify your implementation logic by writing custom test cases in 
          <code className="mx-1 px-1.5 py-0.5 bg-gray-900 border border-gray-800 rounded text-blue-400 font-mono text-[13px]">
            student_tests.py
          </code> 
          before heading into the final boss fight.
        </p>

        <div className="w-full bg-gray-900/40 border border-gray-800/60 rounded-xl p-6 mb-8 text-left">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-4 flex items-center gap-2">
            <Icons.List className="w-3 h-3" />
            Quick Start
          </h3>
          
          <ul className="space-y-4">
            <li className="flex items-start gap-3">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-800 text-[10px] font-bold text-gray-400 shrink-0 mt-0.5">1</span>
              <p className="text-sm text-gray-400 leading-snug">
                Switch to the <span className="text-gray-200 font-medium">student_tests.py</span> tab in the editor
              </p>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-800 text-[10px] font-bold text-gray-400 shrink-0 mt-0.5">2</span>
              <p className="text-sm text-gray-400 leading-snug">
                Write your own Python test functions using assertions
              </p>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-800 text-[10px] font-bold text-gray-400 shrink-0 mt-0.5">3</span>
              <p className="text-sm text-gray-400 leading-snug">
                Add your functions to the <code className="text-[12px] text-blue-400 bg-blue-500/5 px-1 rounded">USER_TESTS</code> list at the bottom
              </p>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-gray-800 text-[10px] font-bold text-gray-400 shrink-0 mt-0.5">4</span>
              <p className="text-sm text-gray-400 leading-snug">
                Click <span className="text-blue-400 font-medium italic">Run All Tests</span> to execute them
              </p>
            </li>
          </ul>
        </div>

        <button 
          onClick={onGoToEditor}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-blue-900/30 active:scale-95"
        >
          <Icons.FileCode className="w-4 h-4" />
          Go to student_tests.py
        </button>

        <div className="mt-8 flex items-center gap-2 text-[11px] text-gray-600 font-medium">
          <Icons.Sword className="w-3 h-3" />
          <span>Or add a test from the Boss Fight tab</span>
        </div>
      </div>
    </div>
  );
};