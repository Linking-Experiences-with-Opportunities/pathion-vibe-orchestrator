"use client";

import { getS3Url } from "@/lib/utils";
import React, { useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { Lesson } from './types';
import CustomMarkdownView from '@/components/CodeEditor/CustomMarkdownView';

const DEFAULT_VIDEO_URL = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

interface LessonContentProps {
  lesson: Lesson;
  onVideoEnd?: () => void;
}

// Helper function to convert any YouTube URL to embed format
function getYouTubeEmbedUrl(url: string): string {
  if (!url) return "";
  
  if (url.includes("youtube.com/watch")) {
    const videoId = url.split("v=")[1]?.split("&")[0];
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
  }
  
  if (url.includes("youtu.be/")) {
    const videoId = url.split("youtu.be/")[1]?.split("?")[0];
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
  }
  
  if (url.includes("youtube.com/embed/")) {
    return url;
  }
  
  return "";
}

function isYouTubeUrl(url: string): boolean {
  if (!url) return false;
  return url.includes("youtube.com") || url.includes("youtu.be");
}

export const LessonContent: React.FC<LessonContentProps> = ({ 
  lesson, 
  onVideoEnd
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const resolvedVideoUrl = lesson.videoUrl
    ? getS3Url(lesson.videoUrl)
    : DEFAULT_VIDEO_URL;

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Video Content
  if (lesson.kind === 'video') {
    return (
      <div className="aspect-video bg-black relative">
        {isYouTubeUrl(lesson.videoUrl || '') ? (
          // YouTube Embed
          <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
            <iframe
              src={getYouTubeEmbedUrl(lesson.videoUrl || '')}
              title={lesson.title}
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              aria-label={`${lesson.title} - YouTube video player`}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
              }}
            />
          </div>
        ) : (
          // Native Video Player
          <>
            {!isPlaying && (
              <div
                className="absolute inset-0 flex items-center justify-center z-10 bg-black/40 backdrop-blur-[2px] transition-all duration-500 cursor-pointer"
                onClick={handlePlayPause}
              >
                <div className="h-20 w-20 rounded-full bg-blue-500/90 flex items-center justify-center pl-1 shadow-[0_0_40px_rgba(59,130,246,0.6)] hover:scale-110 transition-transform duration-300 border border-white/20">
                  <Play fill="white" className="text-white" size={32} />
                </div>
              </div>
            )}
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              controls
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={onVideoEnd}
              poster="https://picsum.photos/1280/720"
            >
              <source
                src={resolvedVideoUrl}
                type="video/mp4"
              />
              Your browser does not support the video tag.
            </video>
          </>
        )}
      </div>
    );
  }

  // Text/Markdown Content
  if (lesson.kind === 'text' && lesson.markdown) {
    return (
      <div>
        <CustomMarkdownView markdown={lesson.markdown} />
      </div>
    );
  }

  // Fallback for other types
  return (
    <div className="flex items-center justify-center h-64 text-zinc-500">
      Content not available
    </div>
  );
};

export default LessonContent;
