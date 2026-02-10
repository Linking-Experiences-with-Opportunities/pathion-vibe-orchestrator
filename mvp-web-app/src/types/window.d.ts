/**
 * Custom Window type extensions
 *
 * Note: Chrome AI types (LanguageModel, Summarizer, etc.) are provided by @types/dom-chromium-ai
 * This file is for any additional window extensions specific to this project.
 */

// Add any custom window properties here
interface Window {
  // Example: custom properties added by your app
  __userId?: string;
  __updateRunnerStatus?: (status: any) => void;
  reportCards?: {
    create: (model?: string, sessionWindow?: number, promptContext?: string) => Promise<any>;
    createFromText: (paragraph: string) => Promise<any>;
    revise: (reportId: string, paragraph: string, reason?: string) => Promise<any>;
    interpret: (reportId?: string) => Promise<any>;
    list: (includeArchived?: boolean) => Promise<any>;
    get: (reportId: string) => Promise<any>;
    archive: (reportId: string) => Promise<any>;
  };
}
