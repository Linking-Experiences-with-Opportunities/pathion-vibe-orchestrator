'use client';

import React from 'react';
import { Status } from '../types';

interface ChartItem {
  id: string;
  status: Status;
}

interface DonutChartProps {
  projects: ChartItem[];
}

const DonutChart: React.FC<DonutChartProps> = ({ projects }) => {
  const size = 140;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const total = projects.length;
  const completed = projects.filter(p => p.status === 'completed').length;
  const inProgress = projects.filter(p => p.status === 'in_progress').length;
  const notStarted = projects.filter(p => p.status === 'not_started').length;

  const completedPercentage = total > 0 ? (completed / total) * 100 : 0;
  const inProgressPercentage = total > 0 ? (inProgress / total) * 100 : 0;

  const getStrokeDasharray = (percentage: number) => {
    const dashLength = (percentage / 100) * circumference;
    return `${dashLength} ${circumference - dashLength}`;
  };

  const getRotation = (offset: number) => {
    return `rotate(${(offset / 100) * 360 - 90} ${size / 2} ${size / 2})`;
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#27272a"
          strokeWidth={strokeWidth}
        />

        {/* Not Started segment (gray) - rendered first as background */}
        {notStarted > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#52525b"
            strokeWidth={strokeWidth}
            strokeDasharray={getStrokeDasharray(100)}
            transform={getRotation(0)}
          />
        )}

        {/* In Progress segment (blue) */}
        {inProgressPercentage > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={strokeWidth}
            strokeDasharray={getStrokeDasharray(inProgressPercentage + completedPercentage)}
            transform={getRotation(0)}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        )}

        {/* Completed segment (green) - rendered on top */}
        {completedPercentage > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#22c55e"
            strokeWidth={strokeWidth}
            strokeDasharray={getStrokeDasharray(completedPercentage)}
            transform={getRotation(0)}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        )}
      </svg>

      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-white">
          {Math.round(completedPercentage)}%
        </span>
        <span className="text-xs text-zinc-500 font-medium">Complete</span>
      </div>
    </div>
  );
};

export default DonutChart;
