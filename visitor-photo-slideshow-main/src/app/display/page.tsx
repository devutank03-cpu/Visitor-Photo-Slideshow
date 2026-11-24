"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

interface SlideshowPhoto {
  id: string;
  visitorId: string;
  imageUrl: string;
  status: string;
  playCount: number;
  createdAt: string;
  visitor: {
    name: string;
    createdAt: string;
  };
  isReturningVisitor: boolean;
}

interface SlideshowApiResponse {
  photos: SlideshowPhoto[];
  slideDurationSeconds: number;
}

export default function SmartTVSlideshowPage() {
  const [photos, setPhotos] = useState<SlideshowPhoto[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideDuration, setSlideDuration] = useState(8);
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const photosRef = useRef<SlideshowPhoto[]>([]);
  const currentIndexRef = useRef(currentIndex);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Poll slideshow queue from backend
  const fetchSlideshow = useCallback(async () => {
    try {
      const res = await fetch("/api/slideshow?limit=25");
      if (!res.ok) return;
      const data: SlideshowApiResponse = await res.json();

      if (data.photos) {
        if (data.slideDurationSeconds) {
          setSlideDuration(data.slideDurationSeconds);
        }

        setPhotos((prev) => {
          // If previous queue was empty and new photos arrived, reset index to 0
          if (prev.length === 0 && data.photos.length > 0) {
            setCurrentIndex(0);
            setProgress(0);
          }
          return data.photos;
        });
      }
    } catch (err) {
      console.error("Failed to poll slideshow queue:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch and 5s polling interval
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSlideshow();
    }, 0);
    const pollInterval = setInterval(fetchSlideshow, 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(pollInterval);
    };
  }, [fetchSlideshow]);

  // Acknowledge slide playback on backend
  const acknowledgePhoto = async (photoId: string) => {
    try {
      await fetch("/api/slideshow/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId }),
      });
    } catch (err) {
      console.error("Failed to ack photo playback:", err);
    }
  };

  // Next Slide Action
  const nextSlide = useCallback(() => {
    const currentList = photosRef.current;
    if (currentList.length === 0) return;

    const currentPhoto = currentList[currentIndexRef.current];
    if (currentPhoto) {
      acknowledgePhoto(currentPhoto.id);
    }

    setCurrentIndex((prev) => (prev + 1) % currentList.length);
    setProgress(0);
  }, []);

  // Previous Slide Action
  const prevSlide = useCallback(() => {
    const currentList = photosRef.current;
    if (currentList.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + currentList.length) % currentList.length);
    setProgress(0);
  }, []);

  // Timer loop for active slide progression
  useEffect(() => {
    if (photos.length === 0 || isPaused) return;

    const stepMs = 50; // 20 updates per second for smooth progress bar
    const totalMs = slideDuration * 1000;
    const increment = (stepMs / totalMs) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          nextSlide();
          return 0;
        }
        return prev + increment;
      });
    }, stepMs);

    return () => clearInterval(timer);
  }, [photos.length, slideDuration, isPaused, nextSlide]);

  // Preload next image to eliminate lag
  useEffect(() => {
    if (photos.length > 1) {
      const nextIdx = (currentIndex + 1) % photos.length;
      const nextImgUrl = photos[nextIdx]?.imageUrl;
      if (nextImgUrl) {
        const img = new Image();
        img.src = nextImgUrl;
      }
    }
  }, [photos, currentIndex]);

  // Auto-hide controls on mouse inactivity
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 4000);
  };

  // Fullscreen toggle handler
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        nextSlide();
      } else if (e.key === "ArrowLeft") {
        prevSlide();
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "p" || e.key === "P") {
        setIsPaused((p) => !p);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextSlide, prevSlide]);

  const currentPhoto = photos[currentIndex];

  return (
    <div
      onMouseMove={handleMouseMove}
      className="relative w-screen h-screen overflow-hidden bg-[#05070B] text-white select-none flex items-center justify-center font-sans"
    >
      {/* ---------------- 1. DYNAMIC COLOR AURA BACKDROP ---------------- */}
      {currentPhoto && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none transition-all duration-1000 ease-out">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`ambient-${currentPhoto.id}`}
            src={currentPhoto.imageUrl}
            alt="Ambient projection"
            className="w-full h-full object-cover blur-[90px] opacity-35 scale-125 transition-opacity duration-1000 ease-in-out"
          />
          {/* Subtle vignette radial mask */}
          <div className="absolute inset-0 bg-radial from-transparent via-[#05070B]/60 to-[#05070B]" />
        </div>
      )}

      {/* ---------------- 2. EMPTY EXHIBIT STATE ---------------- */}
      {!isLoading && photos.length === 0 && (
        <div className="relative z-10 max-w-lg w-full mx-4 p-8 sm:p-12 glass-panel-glow rounded-3xl text-center shadow-2xl animate-fade-in-scale">
          {/* Futuristic radar pulse icon */}
          <div className="relative w-20 h-20 mx-auto mb-6 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 to-cyan-400 p-[1px] shadow-lg shadow-indigo-500/30">
              <div className="w-full h-full bg-[#0E131F] rounded-[15px] flex items-center justify-center text-cyan-400">
                <svg
                  className="w-8 h-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mb-3">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span>EXHIBITION QUEUE STANDBY</span>
          </div>

          <h2 className="text-3xl font-bold tracking-tight text-white mb-3">
            The Digital Canvas Awaits
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed mb-8 max-w-md mx-auto">
            Ready for visitor photographs. Check in and upload photos from your smartphone or kiosk to project them onto this exhibition screen.
          </p>

          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-bold transition-all shadow-lg shadow-indigo-600/30 active:scale-95"
          >
            <span>Open Visitor Check-In</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
        </div>
      )}

      {/* ---------------- 3. MAIN EXHIBITION CANVAS ---------------- */}
      {currentPhoto && (
        <div className="relative z-10 flex flex-col items-center justify-center w-full h-full p-4 sm:p-10">
          {/* Framed Canvas Container with ambient glow */}
          <div className="relative max-w-[88vw] max-h-[82vh] p-2.5 sm:p-4 rounded-3xl bg-black/50 border border-white/15 backdrop-blur-sm shadow-[0_25px_80px_-15px_rgba(0,0,0,0.9)] flex items-center justify-center transition-all duration-700 ease-out group">
            {/* Inner picture bezel */}
            <div className="relative overflow-hidden rounded-2xl bg-black/60 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={currentPhoto.id}
                src={currentPhoto.imageUrl}
                alt={`Photo shared by ${currentPhoto.visitor.name}`}
                className="max-h-[74vh] max-w-[82vw] object-contain rounded-xl transition-all duration-700 animate-fade-in-scale"
              />
            </div>
          </div>

          {/* ---------------- 4. FUTURISTIC EXHIBITION PLAQUE HUD ---------------- */}
          <div className="absolute bottom-6 left-6 sm:bottom-10 sm:left-10 z-20 max-w-sm sm:max-w-md glass-panel-glow rounded-3xl p-5 sm:p-6 shadow-2xl transition-all duration-300">
            {/* Header row with status & queue counter */}
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-[10px] sm:text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
                  Featured Exhibition Guest
                </span>
              </div>

              <div className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/10 text-slate-300 border border-white/10">
                {currentIndex + 1} / {photos.length}
              </div>
            </div>

            {/* Visitor Name */}
            <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-white leading-tight">
              {currentPhoto.visitor.name}
            </h3>

            {/* Returning Visitor VIP Ribbon Badge */}
            {currentPhoto.isReturningVisitor && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 text-amber-300 border border-amber-500/40 tracking-wider uppercase mt-2.5 shadow-sm">
                <span className="text-amber-400 text-sm">★</span>
                <span>Welcome Back • VIP Returning Visitor</span>
              </div>
            )}

            {/* Live Countdown Progress Bar */}
            <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 rounded-full transition-all ease-linear"
                  style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                />
              </div>

              <span className="text-[11px] text-slate-400 font-mono tracking-wider">
                {isPaused ? "PAUSED" : `${Math.ceil((slideDuration * (100 - progress)) / 100)}s`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 5. FLOATING GLASS CONTROL DOCK ---------------- */}
      <div
        className={`absolute top-6 right-6 z-30 flex items-center gap-2 p-1.5 glass-panel-glow rounded-2xl transition-all duration-300 ${
          showControls ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-2 pointer-events-none"
        }`}
      >
        <Link
          href="/"
          className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/15 text-white text-xs font-semibold transition border border-white/10 flex items-center gap-1.5"
          title="Return to Check-In Form"
        >
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>Check-In</span>
        </Link>

        {photos.length > 0 && (
          <>
            <div className="w-[1px] h-5 bg-white/15 mx-0.5" />

            <button
              type="button"
              onClick={prevSlide}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-white transition border border-white/10 cursor-pointer active:scale-95"
              title="Previous photo (Left Arrow)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => setIsPaused((p) => !p)}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-white transition border border-white/10 cursor-pointer active:scale-95"
              title={isPaused ? "Resume slideshow (Space or P)" : "Pause slideshow (Space or P)"}
            >
              {isPaused ? (
                <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-cyan-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={nextSlide}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-white transition border border-white/10 cursor-pointer active:scale-95"
              title="Next photo (Right Arrow or Space)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        <div className="w-[1px] h-5 bg-white/15 mx-0.5" />

        <button
          type="button"
          onClick={toggleFullscreen}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-white transition border border-white/10 cursor-pointer active:scale-95"
          title="Toggle Fullscreen (F)"
        >
          {isFullscreen ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
