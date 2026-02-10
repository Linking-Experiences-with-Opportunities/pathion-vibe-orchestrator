import React from 'react';
import { PlayCircle } from 'lucide-react';

interface VideoPlayerProps {
  thumbnail?: string;
  duration?: string;
  quality?: string;
  onPlay?: () => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ 
  thumbnail = "https://images.unsplash.com/photo-1516116216624-53e697fedbea?q=80&w=1200", 
  duration = "0:00 / 24:15",
  quality = "1080p HQ",
  onPlay 
}) => {
  return (
    <div 
      onClick={onPlay}
      className="aspect-video relative group cursor-pointer bg-zinc-950 flex items-center justify-center overflow-hidden"
    >
      {/* Background Image with Zoom Effect */}
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-40 group-hover:scale-105 transition-transform duration-700"
        style={{ backgroundImage: `url('${thumbnail}')` }} 
      />
      
      {/* Play Button */}
      <div className="relative z-10 w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center shadow-2xl shadow-blue-500/40 group-hover:scale-110 transition-transform">
        <PlayCircle size={40} className="text-white ml-1" />
      </div>

      {/* Video Overlay / Metadata */}
      <div className="absolute bottom-6 left-6 right-6 flex justify-between items-center text-white/50 text-xs font-medium">
        <span>{duration}</span>
        <span>{quality}</span>
      </div>
    </div>
  );
};

export default VideoPlayer;