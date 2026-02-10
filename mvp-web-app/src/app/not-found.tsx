import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full bg-lilo-bg flex flex-col items-center justify-center p-4 font-sans">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold text-white mb-2">Page not found</h1>
        <p className="text-slate-400 text-sm mb-6">
          The page you’re looking for doesn’t exist or has been moved.
        </p>
        <Link
          href="/projects"
          className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-medium"
        >
          Back to Projects
        </Link>
      </div>
    </div>
  );
}
