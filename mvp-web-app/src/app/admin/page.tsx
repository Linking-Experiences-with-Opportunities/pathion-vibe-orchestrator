"use client";

import React, { useEffect, useState } from "react";
import MetricCard from "@/components/Admin/metrics/MetricCard";
import RecentActivity from "@/components/Admin/metrics/RecentActivity";
import SectionTile from "@/components/Admin/metrics/SectionTile";
import type { ActivityItem, MetricData, SectionItem } from "@/components/Admin/metrics/types";
import { useAuthenticatedFetch } from "@/hooks/useAuthenticatedFetch";
import {
  Activity,
  BarChart2,
  BookOpen,
  Database,
  FileText,
  Layers,
  UserPlus,
  Users,
} from "@/components/ui/icons";
import SystemStatusCard from "@/components/Admin/SystemStatusCard";

type AdminOverviewResponse = {
  kpis: {
    submissions24h: { count: number; trendPct: number | null };
    dau24h: { count: number; trendPct: number | null };
    newLearners7d: { count: number; trendPct: number | null };
    activeProjects7d: { count: number; trendPct: number | null };
  };
  recentActivity: ActivityItem[];
};

const SECTIONS: SectionItem[] = [
  {
    id: "metrics",
    title: "Deep Dive Analytics",
    description:
      "Export CSV reports, view individual student progress, and analyze retention cohorts.",
    icon: BarChart2,
    href: "/admin/metrics",
  },
  {
    id: "questions",
    title: "Question Bank",
    description:
      "Manage the database of 500+ coding challenges, multiple choice, and written response items.",
    icon: Database,
    count: 543,
    href: "/admin/questions",
  },
  {
    id: "projects",
    title: "Project Labs",
    description: "Configure multi-file coding environments, grading scripts, and starter templates.",
    icon: Layers,
    count: 24,
    href: "/admin/projects",
  },
  {
    id: "modules",
    title: "Curriculum Modules",
    description: "Organize questions and projects into sequential learning paths and chapters.",
    icon: BookOpen,
    count: 12,
    href: "/admin/modules",
  },
];

export default function AdminHome() {
  const { data: overview, loading, error, execute } = useAuthenticatedFetch<AdminOverviewResponse>();

  useEffect(() => {
    execute("/api/admin/overview");
  }, [execute]);

  const kpis: MetricData[] = [
    {
      id: "1",
      label: "Submissions (24h)",
      value: (overview?.kpis.submissions24h.count ?? 0).toLocaleString(),
      subtext: "Last 24 hours",
      trend: overview?.kpis.submissions24h.trendPct ?? 0,
      trendLabel: overview?.kpis.submissions24h.trendPct === null ? "no prior data" : "vs prior 24h",
      data: [40, 55, 45, 60, 75, 65, 85, 90, 84, 95, 100, 110],
      color: "cyan",
      icon: FileText,
    },
    {
      id: "2",
      label: "Daily Active Users",
      value: (overview?.kpis.dau24h.count ?? 0).toLocaleString(),
      subtext: "Unique learners (24h)",
      trend: overview?.kpis.dau24h.trendPct ?? 0,
      trendLabel: overview?.kpis.dau24h.trendPct === null ? "no prior data" : "vs prior 24h",
      data: [2000, 2100, 2400, 2350, 2600, 2800, 3100, 3204],
      color: "blue",
      icon: Users,
    },
    {
      id: "3",
      label: "New Learners",
      value: (overview?.kpis.newLearners7d.count ?? 0).toLocaleString(),
      subtext: "New signups (7d)",
      trend: overview?.kpis.newLearners7d.trendPct ?? 0,
      trendLabel: overview?.kpis.newLearners7d.trendPct === null ? "no prior data" : "vs prior 7d",
      data: [180, 170, 160, 150, 155, 140, 156],
      color: "teal",
      icon: UserPlus,
    },
    {
      id: "4",
      label: "Active Projects",
      value: (overview?.kpis.activeProjects7d.count ?? 0).toLocaleString(),
      subtext: "Distinct active labs (7d)",
      trend: overview?.kpis.activeProjects7d.trendPct ?? 0,
      trendLabel: overview?.kpis.activeProjects7d.trendPct === null ? "no prior data" : "vs prior 7d",
      data: [15, 15, 16, 17, 18, 18, 18, 18],
      color: "indigo",
      icon: Activity,
    },
  ];

  return (
    <div className="min-h-screen text-white selection:bg-lilo-cyan/30 selection:text-lilo-cyan">
      {/* Background Decor */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-lilo-blue/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-lilo-teal/5 rounded-full blur-[100px]" />
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-[length:100px_100px] opacity-[0.03]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section */}
        <header className="mb-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="text-lilo-cyan text-sm font-semibold tracking-wide uppercase mb-1">
                Admin Dashboard
              </p>
              <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
                Platform Overview
              </h1>
            </div>
            <div className="flex items-center space-x-2 text-sm text-slate-400 bg-slate-900/50 px-4 py-2 rounded-full border border-white/5 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>System Operational</span>
              <span className="text-slate-600">|</span>
              <span>
                {new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>
        </header>

        {/* KPI Grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {kpis.map((kpi) => (
            <MetricCard key={kpi.id} metric={kpi} isLoading={loading} />
          ))}
        </section>

        {/* System Status */}
          <section className="mb-8">
            <SystemStatusCard />
          </section>

        {/* Main Content Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Platform Sections (Interactive Tiles) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold text-white">Platform Management</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {loading
                ? Array(4)
                    .fill(0)
                    .map((_, i) => (
                      <div
                        key={i}
                        className="h-40 rounded-2xl bg-slate-900 animate-pulse border border-white/5"
                      />
                    ))
                : SECTIONS.map((section) => <SectionTile key={section.id} item={section} />)}
            </div>
          </div>

          {/* Right Column: Activity Feed */}
          <div className="lg:col-span-1">
            <div className="flex items-center justify-between mb-4 lg:hidden">
              <h2 className="text-xl font-semibold text-white">Live Activity</h2>
            </div>
            {loading ? (
              <div className="h-96 rounded-2xl bg-slate-900 animate-pulse border border-white/5" />
            ) : (
              <RecentActivity activities={overview?.recentActivity ?? []} />
            )}
          </div>
        </div>

        {error && (
          <div className="mt-8 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            Failed to load live metrics: {error}
          </div>
        )}
      </div>
    </div>
  );
}

