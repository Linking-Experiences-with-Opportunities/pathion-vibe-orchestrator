/**
 * Duration Estimation Utilities
 * 
 * Calculates estimated time to complete different types of learning content:
 * - Text/Reading: Based on word count (average reading speed ~200 wpm)
 * - Video: Uses provided duration or estimates from video length
 * - Project: Uses project estimates from studyPlan/projectEstimates.ts
 * - Question: Fixed estimate for coding questions
 */

import { getProjectEstimate } from './studyPlan/projectEstimates';

// Average reading speed in words per minute
const READING_WPM = 200;

// Default estimates in minutes when no data available
const DEFAULT_ESTIMATES = {
  text: 15,
  video: 10,
  question: 30,
  project: 120, // 2 hours default for projects
  unknown: 15,
};

/**
 * Count words in a markdown string.
 * Strips markdown syntax for more accurate count.
 */
function countWords(markdown: string): number {
  if (!markdown) return 0;
  
  // Remove code blocks
  let text = markdown.replace(/```[\s\S]*?```/g, '');
  // Remove inline code
  text = text.replace(/`[^`]+`/g, '');
  // Remove images
  text = text.replace(/!\[.*?\]\(.*?\)/g, '');
  // Remove links but keep text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Remove markdown headers
  text = text.replace(/#{1,6}\s*/g, '');
  // Remove bold/italic markers
  text = text.replace(/[*_]{1,3}/g, '');
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Split by whitespace and filter empty strings
  const words = text.split(/\s+/).filter(word => word.length > 0);
  return words.length;
}

/**
 * Calculate reading time for text content.
 * @param markdown - The markdown content
 * @returns Estimated minutes to read
 */
export function calculateReadingTime(markdown: string | undefined): number {
  if (!markdown) return DEFAULT_ESTIMATES.text;
  
  const wordCount = countWords(markdown);
  const minutes = Math.ceil(wordCount / READING_WPM);
  
  // Return at least 1 minute, cap at reasonable max
  return Math.max(1, Math.min(minutes, 60));
}

/**
 * Parse video duration from various formats.
 * Supports: number (minutes), string "MM:SS", string "HH:MM:SS"
 */
export function parseVideoDuration(duration: string | number | undefined): number {
  if (duration === undefined || duration === null) return DEFAULT_ESTIMATES.video;
  
  if (typeof duration === 'number') {
    return Math.ceil(duration);
  }
  
  // Parse string formats
  const parts = duration.split(':').map(Number);
  
  if (parts.length === 2) {
    // MM:SS format
    const [minutes, seconds] = parts;
    return Math.ceil(minutes + seconds / 60);
  } else if (parts.length === 3) {
    // HH:MM:SS format
    const [hours, minutes, seconds] = parts;
    return Math.ceil(hours * 60 + minutes + seconds / 60);
  }
  
  // Try parsing as plain number
  const parsed = parseFloat(duration);
  return isNaN(parsed) ? DEFAULT_ESTIMATES.video : Math.ceil(parsed);
}

/**
 * Get project duration estimate using project estimates.
 * @param projectId - The project ID to look up
 * @returns Estimated minutes (uses average of min/max)
 */
export function getProjectDuration(projectId: string | undefined): number {
  if (!projectId) return DEFAULT_ESTIMATES.project;
  
  const estimate = getProjectEstimate(projectId);
  if (!estimate) return DEFAULT_ESTIMATES.project;
  
  // Use average of min and max for display
  const { minMinutes, maxMinutes } = estimate.totalEstimate;
  return Math.ceil((minMinutes + maxMinutes) / 2);
}

/**
 * Format minutes into a human-readable string.
 * Examples: "5 min", "1 hr 30 min", "2 hrs"
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (remainingMinutes === 0) {
    return hours === 1 ? '1 hr' : `${hours} hrs`;
  }
  
  const hourLabel = hours === 1 ? '1 hr' : `${hours} hrs`;
  return `${hourLabel} ${remainingMinutes} min`;
}

/**
 * Calculate estimated duration for any lesson type.
 */
export interface LessonDurationInput {
  kind: 'text' | 'video' | 'question' | 'project' | 'unknown';
  markdown?: string;
  videoDuration?: string | number;
  projectId?: string;
}

export function calculateLessonDuration(input: LessonDurationInput): string {
  let minutes: number;
  
  switch (input.kind) {
    case 'text':
      minutes = calculateReadingTime(input.markdown);
      break;
    case 'video':
      minutes = parseVideoDuration(input.videoDuration);
      break;
    case 'project':
      minutes = getProjectDuration(input.projectId);
      break;
    case 'question':
      minutes = DEFAULT_ESTIMATES.question;
      break;
    case 'unknown':
    default:
      minutes = DEFAULT_ESTIMATES.unknown;
  }
  
  return formatDuration(minutes);
}
