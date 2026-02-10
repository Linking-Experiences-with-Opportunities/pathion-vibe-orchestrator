"use client";

import { useState } from "react";
import { X, Bug, Lightbulb, Upload } from "lucide-react";
import { usePathname } from "next/navigation";
import { useSessionContext } from "@supabase/auth-helpers-react";

type BugReportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  currentPath?: string;
};

type FeatureRequestModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function BugReportModal({
  isOpen,
  onClose,
  currentPath = "",
}: BugReportModalProps) {
  const { session } = useSessionContext();
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form fields
  const [bugTitle, setBugTitle] = useState("");
  const [bugDescription, setBugDescription] = useState("");
  const [pageUrl, setPageUrl] = useState(currentPath);
  const [priority, setPriority] = useState("Low");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("title", bugTitle);
    formData.append("description", bugDescription);
    formData.append("pagePath", pageUrl);
    formData.append("priority", priority);

    if (imageFile) formData.append("image", imageFile);
    if (videoFile) formData.append("video", videoFile);

    try {
      const headers: HeadersInit = {};
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const response = await fetch("/api/bug-report", {
        method: "POST",
        headers,
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        setStatus("success");
        // Clear form
        setBugTitle("");
        setBugDescription("");
        setPageUrl("");
        setPriority("Low");
        setImageFile(null);
        setVideoFile(null);
        setTimeout(() => {
          setStatus("idle");
          onClose();
        }, 2000);
      } else {
        setStatus("error");
        setErrorMessage(
          result.error || "Something went wrong while sending your bug report. Please try again."
        );
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        "Something went wrong while sending your bug report. Please try again."
      );
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bug-report-title"
    >
      <div
        className="relative mx-4 w-full max-w-xl rounded-2xl bg-white dark:bg-neutral-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500">
              <Bug className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2
                id="bug-report-title"
                className="text-xl font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Bug Report
              </h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Found a problem? Let us know so we can fix it.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Bug title */}
          <div>
            <label
              htmlFor="bug-title"
              className="mb-1.5 block text-xs font-medium text-neutral-900 dark:text-neutral-100"
            >
              Bug title
            </label>
            <input
              id="bug-title"
              type="text"
              required
              value={bugTitle}
              onChange={(e) => setBugTitle(e.target.value)}
              placeholder="Feedback Form Submission Fails (Chrome Desktop)"
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:focus:ring-neutral-100/10"
            />
          </div>

          {/* Bug description */}
          <div>
            <label
              htmlFor="bug-description"
              className="mb-1.5 block text-xs font-medium text-neutral-900 dark:text-neutral-100"
            >
              Bug description
            </label>
            <textarea
              id="bug-description"
              required
              value={bugDescription}
              onChange={(e) => setBugDescription(e.target.value)}
              rows={4}
              placeholder="When I click the Submit button, the page reloads but nothing is submitted. No confirmation message appears, and the data is lost. Happens in Chrome on desktop."
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:focus:ring-neutral-100/10"
            />
            <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              Describe the issue, steps to reproduce, and browser/device.
            </p>
          </div>

          {/* Page URL and Priority */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="page-url"
                className="mb-1.5 block text-xs font-medium text-neutral-900 dark:text-neutral-100"
              >
                Page URL or Path
              </label>
              <input
                id="page-url"
                type="text"
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
                placeholder="/dashboard/profile"
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:focus:ring-neutral-100/10"
              />
            </div>
            <div>
              <label
                htmlFor="priority"
                className="mb-1.5 block text-xs font-medium text-neutral-900 dark:text-neutral-100"
              >
                Priority
              </label>
              <select
                id="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:focus:ring-neutral-100/10"
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>
          </div>

          {/* Upload Image and Upload Video */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="upload-image"
                className="mb-1.5 block text-xs font-medium text-neutral-900 dark:text-neutral-100"
              >
                Upload Image
              </label>
              <label
                htmlFor="upload-image"
                className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700"
              >
                <Upload className="h-4 w-4" />
                Image
              </label>
              <input
                id="upload-image"
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              {imageFile && (
                <div className="mt-2 flex items-center justify-between rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
                  <div className="flex-1">
                    <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                      {imageFile.name}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {(imageFile.size / 1024 / 1024).toFixed(2)} mb
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setImageFile(null)}
                    className="text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            <div>
              <label
                htmlFor="upload-video"
                className="mb-1.5 block text-xs font-medium text-neutral-900 dark:text-neutral-100"
              >
                Upload Video
              </label>
              <label
                htmlFor="upload-video"
                className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700"
              >
                <Upload className="h-4 w-4" />
                Video
              </label>
              <input
                id="upload-video"
                type="file"
                accept="video/*"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              {videoFile && (
                <div className="mt-2 flex items-center justify-between rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
                  <div className="flex-1">
                    <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                      {videoFile.name}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {(videoFile.size / 1024 / 1024).toFixed(2)} mb
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setVideoFile(null)}
                    className="text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Status messages */}
          {status === "success" && (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-300">
              Bug report sent successfully! Thank you for your feedback.
            </div>
          )}
          {status === "error" && errorMessage && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={status === "submitting"}
              className="rounded-lg bg-neutral-900 dark:bg-neutral-100 px-4 py-2 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:opacity-50"
            >
              {status === "submitting" ? "Sending..." : "Send bug report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function FeatureRequestModal({
  isOpen,
  onClose,
}: FeatureRequestModalProps) {
  const { session } = useSessionContext();
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form fields
  const [featureSummary, setFeatureSummary] = useState("");
  const [featureDescription, setFeatureDescription] = useState("");
  const [mockupFile, setMockupFile] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("title", featureSummary);
    formData.append("description", featureDescription);

    if (mockupFile) formData.append("mockup", mockupFile);

    try {
      const headers: HeadersInit = {};
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const response = await fetch("/api/feature-request", {
        method: "POST",
        headers,
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        setStatus("success");
        // Clear form
        setFeatureSummary("");
        setFeatureDescription("");
        setMockupFile(null);
        setTimeout(() => {
          setStatus("idle");
          onClose();
        }, 2000);
      } else {
        setStatus("error");
        setErrorMessage(
          result.error || "Something went wrong while sending your feature request. Please try again."
        );
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        "Something went wrong while sending your feature request. Please try again."
      );
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="feature-request-title"
    >
      <div
        className="relative mx-4 w-full max-w-xl rounded-2xl bg-white dark:bg-neutral-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500">
              <Lightbulb className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2
                id="feature-request-title"
                className="text-xl font-semibold text-neutral-900 dark:text-neutral-100"
              >
                Feature Request
              </h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Got an idea to make this better? Drop it below.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Feature summary */}
          <div>
            <label
              htmlFor="feature-summary"
              className="mb-1.5 block text-xs font-medium text-neutral-900 dark:text-neutral-100"
            >
              Feature summary
            </label>
            <input
              id="feature-summary"
              type="text"
              required
              value={featureSummary}
              onChange={(e) => setFeatureSummary(e.target.value)}
              placeholder="Lead Scoring Criteria"
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:focus:ring-neutral-100/10"
            />
          </div>

          {/* Feature description */}
          <div>
            <label
              htmlFor="feature-description"
              className="mb-1.5 block text-xs font-medium text-neutral-900 dark:text-neutral-100"
            >
              Feature description
            </label>
            <textarea
              id="feature-description"
              required
              value={featureDescription}
              onChange={(e) => setFeatureDescription(e.target.value)}
              rows={4}
              placeholder="Let users define their own lead scoring rules inside the app."
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 dark:focus:ring-neutral-100/10"
            />
            <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              {
                "Describe the feature, why it's useful, and how it would improve your workflow."
              }
            </p>
          </div>

          {/* Upload mockup */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-900 dark:text-neutral-100">
              Upload mockup or screenshot (optional)
            </label>
            <div className="relative rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 p-8">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white dark:bg-neutral-800 shadow-sm">
                  <Upload className="h-5 w-5 text-neutral-400" />
                </div>
                <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  Drop a mockup or screenshot here (optional)
                </p>
                <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
                  Maximum file size: 10 MB
                </p>
                <label
                  htmlFor="upload-mockup"
                  className="cursor-pointer rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700"
                >
                  Select files
                </label>
                <input
                  id="upload-mockup"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setMockupFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </div>
              {mockupFile && (
                <div className="mt-4 flex items-center justify-between rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
                  <div className="flex-1">
                    <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                      {mockupFile.name}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {(mockupFile.size / 1024 / 1024).toFixed(2)} mb
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMockupFile(null)}
                    className="text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Status messages */}
          {status === "success" && (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-300">
              Feature request sent successfully! Thank you for your feedback.
            </div>
          )}
          {status === "error" && errorMessage && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={status === "submitting"}
              className="rounded-lg bg-neutral-900 dark:bg-neutral-100 px-4 py-2 text-sm font-medium text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 disabled:opacity-50"
            >
              {status === "submitting" ? "Sending..." : "Send request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function FeedbackWidget() {
  // HIDDEN FOR DEMO
  return null;

  const [isBugModalOpen, setIsBugModalOpen] = useState(false);
  const [isFeatureModalOpen, setIsFeatureModalOpen] = useState(false);
  const pathname = usePathname();

  // Hide widget on unsupported page
  if (pathname === "/unsupported") {
    return null;
  }

  return (
    <>
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-4">
        {/* Feature Request Button */}
        <div className="group relative flex items-center justify-end">
          <div className="absolute right-full mr-3 hidden whitespace-nowrap rounded-md bg-neutral-900 dark:bg-neutral-100 px-2 py-1 text-xs font-medium text-white dark:text-neutral-900 shadow-sm group-hover:block">
            Feature Request
          </div>
          <button
            onClick={() => setIsFeatureModalOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500 text-white shadow-lg transition-transform hover:scale-105 hover:bg-blue-600 active:scale-95"
            aria-label="Request a feature"
          >
            <Lightbulb className="h-6 w-6" />
          </button>
        </div>

        {/* Bug Report Button */}
        <div className="group relative flex items-center justify-end">
          <div className="absolute right-full mr-3 hidden whitespace-nowrap rounded-md bg-neutral-900 dark:bg-neutral-100 px-2 py-1 text-xs font-medium text-white dark:text-neutral-900 shadow-sm group-hover:block">
            Report a Bug
          </div>
          <button
            onClick={() => setIsBugModalOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500 text-white shadow-lg transition-transform hover:scale-105 hover:bg-red-600 active:scale-95"
            aria-label="Report a bug"
          >
            <Bug className="h-6 w-6" />
          </button>
        </div>
      </div>

      <BugReportModal
        isOpen={isBugModalOpen}
        onClose={() => setIsBugModalOpen(false)}
        currentPath={pathname}
      />

      <FeatureRequestModal
        isOpen={isFeatureModalOpen}
        onClose={() => setIsFeatureModalOpen(false)}
      />
    </>
  );
}

