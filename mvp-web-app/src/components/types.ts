export type Status = "not_started" | "in_progress" | "completed";
export type ActivityStatus = "not_started" | "in_progress" | "completed" | "locked";
// NOTE: "unknown" is for unrecognized backend types — renders as placeholder
export type ActivityType = "reading" | "lecture" | "project" | "question" | "unknown";

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;  
  status: ActivityStatus;
  duration?: string; // e.g., "10 min", "45 min"
}

export interface Module {
  id: number | string;
  slug: string;
  title: string;
  description: string;
  activities: Activity[];
  status?: Status; // Overall module status
}

export interface ActivityGroup {
  type: 'group';
  activityType: ActivityType;
  title: string;
  activities: Activity[];
}

/**
 * Interface for project tracking, used in project-related panels and charts.
 */
export interface ProjectProgress {
  id: number;
  name: string;
  description: string;
  status: Status;
  completedTests: number;
  totalTests: number;
}

export const STATUS_COLORS = {
  completed: '#22c55e', // green-500
  in_progress: '#3b82f6', // blue-500
  not_started: '#3f3f46', // zinc-700
};

export const ACTIVITY_ICONS = {
  reading: "BookOpen",
  lecture: "PlayCircle",
  project: "Code2",
  problem: "Target",
};
