// NOTE: "unknown" is for unrecognized backend types — renders as placeholder
export type LessonKind = "text" | "video" | "question" | "project" | "unknown";

export interface Lesson {
  id: string;
  title: string;
  kind: LessonKind;
  videoUrl?: string;
  markdown?: string;
  problemData?: any;
  projectData?: any;
  isCompleted: boolean;
  isLocked?: boolean;
  duration?: number;
  description?: string;
  estimatedDuration?: string; // Human-readable duration estimate (e.g., "15 min", "2 hrs")
}

export interface CourseData {
  title: string;
  lessons: Lesson[];
}
