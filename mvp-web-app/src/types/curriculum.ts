/**
 * Curriculum Content Types
 * 
 * These types define the structure of module content items.
 * 
 * IMPORTANT: The frontend type system is a SUPERSET of what the backend supports.
 * This is intentional — frontend may define future content types before backend implements them.
 * 
 * Backend contract (questions-api/docs/backend_api_contract.md) currently guarantees ONLY:
 *   "text" | "question"
 * 
 * Frontend additionally handles (for future-proofing):
 *   "video" | "project"
 * 
 * Do NOT assume backend persistence for types not in BackendSupportedContentType.
 */

// --- Backend Contract Boundary ---

/**
 * Content types GUARANTEED by the backend contract.
 * See: questions-api/docs/backend_api_contract.md (Module Detail Screen section)
 * 
 * If you need a type not listed here, ASK before assuming backend support.
 */
export type BackendSupportedContentType = "text" | "question";

/**
 * All content types the frontend can handle (superset of backend).
 * Includes types that may not yet be persisted by backend.
 */
export type ContentType = BackendSupportedContentType | "video" | "project";

/**
 * Runtime check: Is this content type supported by the backend contract?
 */
export function isBackendSupportedType(type: string): type is BackendSupportedContentType {
  return type === "text" || type === "question";
}

/**
 * Runtime check: Is this a known frontend content type?
 */
export function isKnownContentType(type: string): type is ContentType {
  return type === "text" || type === "question" || type === "video" || type === "project";
}

// --- Content Data Shapes ---

export interface TextContent {
  title: string;
  content: string; // markdown body
  description?: string;
  estimatedMinutes?: number;
}

export interface VideoContent {
  title: string;
  videoUrl: string; // youtube | s3 | relative path
  description?: string;
  duration?: number; // seconds
}

/**
 * Question content embeds a full QuestionPayload for now.
 * Future: may reference by questionId instead.
 */
export interface QuestionContent {
  questionId?: string;
  // Embedded question data (current implementation)
  title?: string;
  description?: string;
  code_snippet?: string;
  driver?: string;
  methodName?: string;
  className?: string;
  difficulty?: "easy" | "medium" | "hard";
  testcases?: Array<{
    input: string;
    expected_output: string;
  }>;
}

export interface ProjectContent {
  projectId: string;
  title?: string;
}

// Union type for content data
export type ContentData =
  | TextContent
  | VideoContent
  | QuestionContent
  | ProjectContent;

/**
 * A single content item within a module.
 * The `type` field determines how `data` should be interpreted.
 */
export interface ContentItem {
  id: string;
  type: ContentType;
  data: ContentData;
}

// --- Type Guards ---

export function isTextContent(item: ContentItem): item is ContentItem & { data: TextContent } {
  return item.type === "text";
}

export function isVideoContent(item: ContentItem): item is ContentItem & { data: VideoContent } {
  return item.type === "video";
}

export function isQuestionContent(item: ContentItem): item is ContentItem & { data: QuestionContent } {
  return item.type === "question";
}

export function isProjectContent(item: ContentItem): item is ContentItem & { data: ProjectContent } {
  return item.type === "project";
}

// --- Frontend Activity Type Mapping ---
// Used by adapters to convert backend types to UI display types

/**
 * ActivityType includes "unknown" for unrecognized backend types.
 * This ensures we never silently coerce unknown types.
 */
export type ActivityType = "reading" | "lecture" | "question" | "project" | "unknown";

export type Status = "not_started" | "in_progress" | "completed";

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  status: Status;
  duration?: string; // e.g., "10 min", "45 min"
}

export interface ActivityGroup {
  type: 'group';
  activityType: ActivityType;
  title: string; // usually derived from the first item
  activities: Activity[];
}



/**
 * Maps ContentType to frontend ActivityType for UI display.
 * This is the ONLY place this mapping should be defined.
 * 
 * IMPORTANT: Does NOT handle unknown types — use contentTypeToActivityTypeSafe for that.
 */
export function contentTypeToActivityType(contentType: ContentType): ActivityType {
  switch (contentType) {
    case "text":
      return "reading";
    case "video":
      return "lecture";
    case "question":
      return "question";
    case "project":
      return "project";
    default:
      // Exhaustive check - TypeScript will error if a case is missing
      const _exhaustive: never = contentType;
      return "reading";
  }
}

// --- Safe Adapter for Backend Data ---

/**
 * Safely maps a raw backend content type string to ActivityType.
 * 
 * - Known types are mapped normally
 * - Unknown types return "unknown" and log a warning
 * - NEVER coerces unknown types to other types
 */
export function contentTypeToActivityTypeSafe(rawType: string): ActivityType {
  if (!isKnownContentType(rawType)) {
    console.warn(
      `[Curriculum] Unknown content type "${rawType}" received from backend. ` +
      `Expected one of: text, question, video, project. ` +
      `This content will render as a placeholder.`
    );
    return "unknown";
  }
  
  // TODO: Remove this warning once backend supports video/project
  if (!isBackendSupportedType(rawType)) {
    console.warn(
      `[Curriculum] Content type "${rawType}" is not yet supported by backend contract. ` +
      `Rendering frontend-only preview.`
    );
  }
  
  return contentTypeToActivityType(rawType);
}
