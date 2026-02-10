import React, { useState } from 'react';
import OverallMetrics from '../OverallMetrics';
import { AdminUsersPage } from './AdminUsersPage';

type Tab = 'overall' | 'users';

export const LearningAnalyticsDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overall');

  return (
    <div className="min-h-screen  text-slate-200 font-sans selection:bg-blue-500/30 pb-20">

      {/* Main Header */}
      <header className="px-6 py-8  relative overflow-hidden border-b border-slate-900">
        {/* Background FX */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 pointer-events-none"></div>
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/5 blur-[100px] rounded-full pointer-events-none"></div>

        <div className="relative z-10 max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight mb-1">Learning Analytics</h1>
            <p className="text-slate-400">Track platform usage and user engagement</p>
          </div>

          <div className="relative">
            <select aria-label="Select time period" className="appearance-none bg-slate-900 border border-slate-700 text-slate-300 py-2 pl-4 pr-10 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
              <option>Last 7 days</option>
              <option>Last 30 days</option>
              <option>Last 90 days</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="relative z-10 max-w-7xl mx-auto mt-8 flex gap-2">
          <button
            onClick={() => setActiveTab('overall')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-all ${activeTab === 'overall'
                ? 'border-blue-500 text-white bg-slate-900/50'
                : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-900/30'
              }`}
          >
            Overall Metrics
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-all ${activeTab === 'users'
                ? 'border-blue-500 text-white bg-slate-900/50'
                : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-900/30'
              }`}
          >
            User Metrics
          </button>
        </div>
      </header>

      {/* Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overall' ? (
          <OverallMetrics metrics={null} includeInternal={false} />
        ) : (
          <AdminUsersPage />
        )}
      </main>
    </div>
  );
};
