import React from 'react';
import Image from 'next/image';
import { Submission, TimeRange, TIME_RANGE_OPTIONS } from '../types';
import { Clock, CheckCircle2, XCircle, Search, RefreshCw, Monitor } from 'lucide-react';

interface SubmissionsTableProps {
  submissions: Submission[];
  loading: boolean;
  timeRange?: TimeRange;
  onTimeRangeChange?: (value: TimeRange) => void;
  onRefresh?: () => void;
}

const SubmissionsTable: React.FC<SubmissionsTableProps> = ({
  submissions,
  loading,
  timeRange = '7d',
  onTimeRangeChange,
  onRefresh,
}) => {

  // Helper to format "time ago"
  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="bg-[#181b21] rounded-xl border border-gray-800 flex flex-col h-full overflow-hidden">
      <div className="p-6 border-b border-gray-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            Latest Project Runs
            <span className="px-2 py-0.5 rounded-full bg-gray-800 text-xs text-gray-400 border border-gray-700">Live</span>
          </h3>
          <p className="text-sm text-gray-500 mt-1">Real-time feed of user code submissions</p>
        </div>

        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
            <input
              type="text"
              placeholder="Search user..."
              className="w-full sm:w-48 bg-[#111316] border border-gray-700 text-gray-300 text-sm rounded-lg pl-9 pr-3 py-1.5 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          {onTimeRangeChange && (
            <select
              value={timeRange}
              onChange={(e) => onTimeRangeChange(e.target.value as TimeRange)}
              aria-label="Filter by time range"
              className="bg-[#111316] border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 transition-colors"
            >
              {TIME_RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 bg-[#111316] border border-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#1f242b]/50 text-gray-500 text-xs uppercase tracking-wider font-semibold">
              <th className="p-4 pl-6">User</th>
              <th className="p-4">Project</th>
              <th className="p-4">OS</th>
              <th className="p-4 text-center">Status</th>
              <th className="p-4 w-48">Test Coverage</th>
              <th className="p-4 pr-6 text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {loading ? (
              // Loading Skeleton
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="p-4 pl-6"><div className="h-4 bg-gray-800 rounded w-32"></div></td>
                  <td className="p-4"><div className="h-4 bg-gray-800 rounded w-24"></div></td>
                  <td className="p-4"><div className="h-6 bg-gray-800 rounded-full w-16 mx-auto"></div></td>
                  <td className="p-4"><div className="h-2 bg-gray-800 rounded w-full"></div></td>
                  <td className="p-4 pr-6"><div className="h-3 bg-gray-800 rounded w-12 ml-auto"></div></td>
                </tr>
              ))
            ) : submissions.length === 0 ? (
              // Empty State
              <tr>
                <td colSpan={6} className="p-8 text-center">
                  <div className="text-gray-500 text-sm">
                    No submissions found for the selected time range
                  </div>
                </td>
              </tr>
            ) : (
              submissions.map((sub) => (
                <tr key={sub._id} className="hover:bg-gray-800/30 transition-colors group">
                  <td className="p-4 pl-6">
                    <div className="flex items-center gap-3">
                      {sub.image ? (
                        <Image
                          src={sub.image}
                          alt={sub.userId}
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-full border border-gray-600 object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-800 border border-gray-600 flex items-center justify-center text-xs font-medium text-gray-300">
                          {sub.userId.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">
                          {sub.userId}
                        </span>
                        <span className="text-[11px] text-gray-500 truncate max-w-[150px]" title={sub.email}>
                          {sub.email || 'No email'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="text-sm text-gray-300">{sub.projectTitle}</span>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">ID: #{sub.problemId}</div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Monitor size={14} />
                      <span className="text-xs">{sub.os || 'Unknown'}</span>
                    </div>
                  </td>
                  <td className="p-4 text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${sub.passed
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                        }`}>
                        {sub.passed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                        {sub.passed ? 'Passed' : 'Failed'}
                      </span>
                      {sub.durationMs !== undefined && (
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border ${sub.durationMs <= 100
                            ? 'bg-green-500/10 text-green-400 border-green-500/20'
                            : sub.durationMs <= 250
                              ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}>
                          {sub.durationMs}ms
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-[11px] font-medium text-gray-400">
                        <span>{sub.testSummary.passed}/{sub.testSummary.total} passing</span>
                        <span>{sub.testSummary.total > 0 ? Math.round((sub.testSummary.passed / sub.testSummary.total) * 100) : 0}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${sub.passed ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ width: `${sub.testSummary.total > 0 ? (sub.testSummary.passed / sub.testSummary.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="p-4 pr-6 text-right">
                    <div className="flex items-center justify-end gap-1.5 text-xs text-gray-500">
                      <Clock size={12} />
                      {getTimeAgo(sub.createdAt)}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Table Footer */}
      <div className="p-4 border-t border-gray-800 flex justify-center">
        <button className="text-xs font-medium text-gray-400 hover:text-white transition-colors">
          View all submissions
        </button>
      </div>
    </div>
  );
};

export default SubmissionsTable;