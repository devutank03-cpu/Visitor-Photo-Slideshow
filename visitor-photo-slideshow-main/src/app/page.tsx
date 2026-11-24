"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

interface VisitorPhoto {
  id: string;
  imageUrl: string;
  status: string;
  playCount: number;
  createdAt: string;
}

interface VisitorDetails {
  id: string;
  name: string;
  contact: string;
  createdAt: string;
}

interface UploadResponse {
  success: boolean;
  isReturningVisitor?: boolean;
  visitor?: VisitorDetails;
  queuedPhotosCount?: number;
  error?: string;
}

interface SelectedPhoto {
  file: File;
  previewUrl: string;
}

const MAX_FILES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function VisitorCheckInPage() {
  const [activeTab, setActiveTab] = useState<"checkin" | "manage">("checkin");

  // Check-In Form State
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [consent, setConsent] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manage Tab State
  const [manageContact, setManageContact] = useState("");
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
  const [visitorData, setVisitorData] = useState<{
    visitor: VisitorDetails | null;
    photos: VisitorPhoto[];
  } | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageSuccess, setManageSuccess] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      selectedPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, [selectedPhotos]);

  // Handle files selection & client-side validation
  const handleFiles = (incomingFiles: FileList | File[]) => {
    setFileError(null);
    const filesArray = Array.from(incomingFiles);

    if (selectedPhotos.length + filesArray.length > MAX_FILES) {
      setFileError(`Maximum ${MAX_FILES} photos allowed. Please select fewer.`);
      return;
    }

    const validatedPhotos: SelectedPhoto[] = [];
    for (const file of filesArray) {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        setFileError(`'${file.name}' is not supported. Use JPEG, PNG, or WebP.`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setFileError(
          `'${file.name}' exceeds 5MB size limit (${(
            file.size /
            (1024 * 1024)
          ).toFixed(1)}MB).`
        );
        return;
      }
      validatedPhotos.push({
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    setSelectedPhotos((prev) => [...prev, ...validatedPhotos]);
  };

  const removeSelectedFile = (index: number) => {
    setSelectedPhotos((prev) => {
      const removed = prev[index];
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
    setFileError(null);
  };

  // Check-in submission
  const handleSubmitCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent || selectedPhotos.length === 0 || !name.trim() || !contact.trim()) {
      return;
    }

    setIsSubmitting(true);
    setUploadResult(null);
    setFileError(null);

    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("contact", contact.trim());
      formData.append("consent", consent ? "true" : "false");
      selectedPhotos.forEach((item) => {
        formData.append("photos", item.file);
      });

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data: UploadResponse = await res.json();
      setUploadResult(data);

      if (data.success) {
        setName("");
        setContact("");
        setConsent(false);
        selectedPhotos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        setSelectedPhotos([]);
      }
    } catch {
      setUploadResult({
        success: false,
        error: "Network error occurred while submitting your photos. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load photos for management
  const handleLoadPhotos = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!manageContact.trim()) return;

    setIsLoadingPhotos(true);
    setManageError(null);
    setManageSuccess(null);

    try {
      const res = await fetch(
        `/api/visitor/photos?contact=${encodeURIComponent(manageContact.trim())}`
      );
      const data = await res.json();

      if (data.success) {
        setVisitorData({
          visitor: data.visitor,
          photos: data.photos || [],
        });
        if (!data.visitor || data.photos.length === 0) {
          setManageError("No exhibition photos found for this email or phone number.");
        }
      } else {
        setManageError(data.error || "Failed to retrieve photos.");
      }
    } catch {
      setManageError("Unable to connect to the exhibition server.");
    } finally {
      setIsLoadingPhotos(false);
    }
  };

  // Delete single photo
  const handleDeletePhoto = async (photoId: string) => {
    if (!confirm("Remove this photograph permanently from the live exhibition display?")) {
      return;
    }

    setIsDeleting(photoId);
    setManageError(null);
    setManageSuccess(null);

    try {
      const res = await fetch("/api/visitor/photos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: manageContact.trim(),
          photoId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setManageSuccess("Photograph successfully removed from the exhibition.");
        setVisitorData((prev) =>
          prev
            ? {
                ...prev,
                photos: prev.photos.filter((p) => p.id !== photoId),
              }
            : null
        );
      } else {
        setManageError(data.error || "Failed to delete photo.");
      }
    } catch {
      setManageError("Network error occurred during deletion.");
    } finally {
      setIsDeleting(null);
    }
  };

  // Delete all photos
  const handleDeleteAllPhotos = async () => {
    if (
      !confirm(
        "Permanently purge ALL your photos from the gallery exhibition? This action cannot be reversed."
      )
    ) {
      return;
    }

    setIsDeleting("all");
    setManageError(null);
    setManageSuccess(null);

    try {
      const res = await fetch("/api/visitor/photos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: manageContact.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setManageSuccess("All your photos have been completely purged from the exhibition.");
        setVisitorData((prev) =>
          prev
            ? {
                ...prev,
                photos: [],
              }
            : null
        );
      } else {
        setManageError(data.error || "Failed to purge photos.");
      }
    } catch {
      setManageError("Network error occurred during deletion.");
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090E] text-[#F8FAFC] flex flex-col justify-between py-6 px-4 sm:px-6 relative overflow-hidden aurora-bg">
      {/* Decorative ambient glowing orbs */}
      <div className="absolute top-[-120px] left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-150px] right-[-100px] w-[500px] h-[400px] bg-cyan-600/10 rounded-full blur-[130px] pointer-events-none" />

      {/* Top Header Bar */}
      <header className="max-w-4xl mx-auto w-full flex items-center justify-between pb-6 border-b border-white/10 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 via-violet-500 to-cyan-400 p-[1px] shadow-lg shadow-indigo-500/20">
            <div className="w-full h-full bg-[#0E131F] rounded-[11px] flex items-center justify-center">
              <svg
                className="w-5 h-5 text-indigo-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-[11px] font-semibold tracking-widest text-indigo-400 uppercase">
                Live Interactive Installation
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Visitor Exhibition Lens
            </h1>
          </div>
        </div>

        <Link
          href="/display"
          target="_blank"
          className="group relative inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold bg-white/5 hover:bg-white/10 text-white border border-white/15 hover:border-indigo-500/50 transition-all duration-300 shadow-md backdrop-blur-md active:scale-95"
          title="Open live Smart TV exhibition display"
        >
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>Smart TV Screen</span>
          <svg
            className="w-3.5 h-3.5 text-indigo-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </Link>
      </header>

      {/* Main Content Card */}
      <main className="max-w-xl w-full mx-auto my-6 relative z-10">
        <div className="glass-panel-glow rounded-3xl overflow-hidden transition-all duration-300">
          {/* Segmented Control Tabs */}
          <div className="p-2 border-b border-white/10 bg-white/[0.02]">
            <div className="grid grid-cols-2 gap-2 bg-[#0A0E18]/80 p-1.5 rounded-2xl border border-white/5">
              <button
                type="button"
                onClick={() => setActiveTab("checkin")}
                className={`py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 ${
                  activeTab === "checkin"
                    ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/30 border border-indigo-400/30"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span>Upload & Check-In</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("manage")}
                className={`py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 ${
                  activeTab === "manage"
                    ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/30 border border-indigo-400/30"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                <span>Manage & Privacy</span>
              </button>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            {/* ---------------- TAB 1: CHECK-IN & UPLOAD ---------------- */}
            {activeTab === "checkin" && (
              <div>
                <div className="mb-6">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    PUBLIC GALLERY SPOTLIGHT
                  </span>
                  <h2 className="text-2xl font-bold tracking-tight text-white">
                    Broadcast Your Moments
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Upload up to 3 photographs to be featured on the museum’s large-scale live digital showcase.
                  </p>
                </div>

                {/* Upload Success / Returning Visitor Banner */}
                {uploadResult && (
                  <div
                    className={`mb-6 p-4 rounded-2xl border text-sm transition animate-fade-in-scale ${
                      uploadResult.success
                        ? uploadResult.isReturningVisitor
                          ? "bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent border-amber-500/40 text-amber-200"
                          : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                    }`}
                  >
                    {uploadResult.success ? (
                      <div>
                        <div className="flex items-center gap-2 font-bold text-base">
                          {uploadResult.isReturningVisitor ? (
                            <>
                              <span className="text-amber-400 text-lg">★</span>
                              <span className="text-amber-300">Welcome Back VIP Guest!</span>
                            </>
                          ) : (
                            <>
                              <svg
                                className="w-5 h-5 text-emerald-400 flex-shrink-0"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              <span>Added to Live Exhibit Queue!</span>
                            </>
                          )}
                        </div>

                        {uploadResult.isReturningVisitor ? (
                          <p className="mt-2 text-slate-200 text-xs sm:text-sm leading-relaxed">
                            We recognized you! Your previous photographs have been automatically re-queued alongside your new submissions so your full collection plays together on screen (
                            <strong className="text-amber-300">{uploadResult.queuedPhotosCount}</strong> photos currently in rotation).
                          </p>
                        ) : (
                          <p className="mt-2 text-slate-300 text-xs sm:text-sm">
                            Welcome to the exhibit,{" "}
                            <strong className="text-white">{uploadResult.visitor?.name}</strong>! Your photos have been processed and will rotate onto the live screen shortly.
                          </p>
                        )}

                        <div className="mt-4 flex items-center gap-4">
                          <Link
                            href="/display"
                            target="_blank"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/20 transition"
                          >
                            <span>Watch Live Screen</span>
                            <span>↗</span>
                          </Link>
                          <button
                            type="button"
                            onClick={() => setUploadResult(null)}
                            className="text-xs text-slate-400 hover:text-white transition"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <svg
                          className="w-5 h-5 text-rose-400 mt-0.5 flex-shrink-0"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <div>
                          <span className="font-semibold block">Submission Error</span>
                          <span className="text-xs opacity-90">{uploadResult.error || "An error occurred while uploading."}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <form onSubmit={handleSubmitCheckIn} className="space-y-5">
                  {/* Visitor Name */}
                  <div>
                    <label
                      htmlFor="visitor-name"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2"
                    >
                      Your Full Name <span className="text-indigo-400">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <input
                        id="visitor-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Maya Lin"
                        className="glass-input w-full pl-10 pr-4 py-3 rounded-xl text-sm placeholder-slate-500"
                      />
                    </div>
                  </div>

                  {/* Phone or Email */}
                  <div>
                    <label
                      htmlFor="visitor-contact"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2"
                    >
                      Phone or Email <span className="text-indigo-400">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <input
                        id="visitor-contact"
                        type="text"
                        required
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                        placeholder="e.g. maya@gallery.org or +1 (555) 019-2834"
                        className="glass-input w-full pl-10 pr-4 py-3 rounded-xl text-sm placeholder-slate-500"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Recognizes you on return and gives you complete privacy deletion control.</span>
                    </p>
                  </div>

                  {/* Drag and Drop Upload Area */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Select Photographs (1 to 3) <span className="text-indigo-400">*</span>
                      </label>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {selectedPhotos.length}/{MAX_FILES} SELECTED
                      </span>
                    </div>

                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        if (e.dataTransfer.files) {
                          handleFiles(e.dataTransfer.files);
                        }
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      className={`relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all duration-300 flex flex-col items-center justify-center ${
                        isDragging
                          ? "border-cyan-400 bg-cyan-500/10 shadow-lg shadow-cyan-500/20 scale-[0.99]"
                          : "border-white/15 bg-white/[0.02] hover:bg-white/[0.05] hover:border-indigo-400/50"
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) {
                            handleFiles(e.target.files);
                          }
                        }}
                      />

                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500/20 to-cyan-500/20 border border-white/10 text-indigo-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                        <svg
                          className="w-6 h-6 text-cyan-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                          />
                        </svg>
                      </div>

                      <p className="text-sm font-semibold text-white">
                        Drop high-res photos here, or{" "}
                        <span className="text-indigo-400 underline decoration-indigo-400/50 underline-offset-2">browse files</span>
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        JPEG, PNG, or WebP • Max 5MB per file • Up to 3 photos
                      </p>
                    </div>

                    {fileError && (
                      <p className="text-xs text-rose-400 font-medium mt-2 flex items-center gap-1.5 animate-fade-in-scale">
                        <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span>{fileError}</span>
                      </p>
                    )}
                  </div>

                  {/* Modern Exhibition Photo Previews */}
                  {selectedPhotos.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          Selected Previews
                        </span>
                        {selectedPhotos.length < MAX_FILES && (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="text-xs text-indigo-400 font-semibold hover:underline"
                          >
                            + Add more
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-3 pt-1">
                        {selectedPhotos.map((photoItem, index) => (
                          <div
                            key={photoItem.previewUrl}
                            className="group relative rounded-2xl overflow-hidden border border-white/15 bg-white/[0.04] p-1.5 transition-all duration-300 hover:border-indigo-400/50 hover:shadow-lg hover:shadow-indigo-500/10"
                          >
                            <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-black/40">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={photoItem.previewUrl}
                                alt={`Preview ${index + 1}`}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />

                              {/* Remove Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeSelectedFile(index);
                                }}
                                className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/70 hover:bg-rose-600 text-white rounded-full flex items-center justify-center transition-all shadow-md backdrop-blur-sm cursor-pointer"
                                title="Remove photo"
                              >
                                ×
                              </button>

                              {/* Index badge */}
                              <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-black/60 text-white backdrop-blur-sm">
                                #{index + 1}
                              </div>
                            </div>

                            <div className="mt-1.5 px-1 flex items-center justify-between text-[10px] text-slate-400">
                              <span className="truncate max-w-[70px]">
                                {photoItem.file.name}
                              </span>
                              <span className="font-mono text-slate-400">
                                {(photoItem.file.size / (1024 * 1024)).toFixed(1)}M
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Privacy & Consent Checkbox */}
                  <div className="pt-1">
                    <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 cursor-pointer hover:bg-white/[0.06] hover:border-white/20 transition-all">
                      <input
                        type="checkbox"
                        required
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black/40 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer"
                      />
                      <span className="text-xs text-slate-300 leading-relaxed">
                        I consent to featuring my photos publicly on the museum exhibition screen.
                        <span className="block text-[11px] text-slate-400 mt-0.5">
                          You retain full intellectual property and can remove your photos at any time in the Manage tab.
                        </span>
                      </span>
                    </label>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={
                      !consent ||
                      selectedPhotos.length === 0 ||
                      !name.trim() ||
                      !contact.trim() ||
                      isSubmitting
                    }
                    className={`w-full py-3.5 px-6 rounded-2xl font-bold text-sm tracking-wide transition-all duration-300 flex items-center justify-center gap-2 shadow-lg ${
                      !consent ||
                      selectedPhotos.length === 0 ||
                      !name.trim() ||
                      !contact.trim() ||
                      isSubmitting
                        ? "bg-white/5 text-slate-500 border border-white/5 cursor-not-allowed shadow-none"
                        : "shimmer-btn text-white shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <svg
                          className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v8H4z"
                          />
                        </svg>
                        <span>Transmitting to Exhibition...</span>
                      </>
                    ) : (
                      <>
                        <span>Broadcast to Exhibition Display</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* ---------------- TAB 2: MANAGE / PRIVACY ---------------- */}
            {activeTab === "manage" && (
              <div>
                <div className="mb-6">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    SELF-SERVICE PRIVACY VAULT
                  </span>
                  <h2 className="text-2xl font-bold tracking-tight text-white">
                    Manage Your Photos
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    Enter the phone number or email you submitted at check-in to review or permanently delete your pictures from the exhibit.
                  </p>
                </div>

                {/* Search Form */}
                <form onSubmit={handleLoadPhotos} className="flex gap-2 mb-6">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      required
                      value={manageContact}
                      onChange={(e) => setManageContact(e.target.value)}
                      placeholder="Enter phone or email"
                      className="glass-input w-full pl-10 pr-4 py-3 rounded-xl text-sm placeholder-slate-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoadingPhotos || !manageContact.trim()}
                    className="px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs sm:text-sm font-semibold transition disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-600/20"
                  >
                    {isLoadingPhotos ? "Searching..." : "Lookup"}
                  </button>
                </form>

                {/* Alerts */}
                {manageError && (
                  <div className="mb-5 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5 animate-fade-in-scale">
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span>{manageError}</span>
                  </div>
                )}

                {manageSuccess && (
                  <div className="mb-5 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2.5 animate-fade-in-scale">
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>{manageSuccess}</span>
                  </div>
                )}

                {/* Photo Management Grid */}
                {visitorData && visitorData.photos.length > 0 && (
                  <div className="space-y-4 animate-fade-in-scale">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <span>{visitorData.visitor?.name}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            {visitorData.photos.length} photo{visitorData.photos.length !== 1 ? "s" : ""}
                          </span>
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          Active in gallery exhibition rotation
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleDeleteAllPhotos}
                        disabled={isDeleting !== null}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition cursor-pointer disabled:opacity-50 flex items-center gap-1"
                      >
                        {isDeleting === "all" ? "Purging..." : "Purge All Photos"}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {visitorData.photos.map((photo) => (
                        <div
                          key={photo.id}
                          className="glass-panel rounded-2xl p-2 flex flex-col justify-between border border-white/10 hover:border-white/20 transition-all shadow-md group"
                        >
                          <div className="aspect-square w-full rounded-xl overflow-hidden bg-black/50 mb-2 relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo.imageUrl}
                              alt="Exhibited photograph"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <span
                              className={`absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase backdrop-blur-md ${
                                photo.status === "QUEUED"
                                  ? "bg-cyan-500/80 text-white shadow-sm"
                                  : "bg-black/60 text-slate-300"
                              }`}
                            >
                              {photo.status}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] pt-1 px-1">
                            <span className="text-slate-400 font-mono flex items-center gap-1">
                              <span className="text-amber-400">✦</span>
                              <span>{photo.playCount} plays</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeletePhoto(photo.id)}
                              disabled={isDeleting !== null}
                              className="text-xs font-semibold text-rose-400 hover:text-rose-300 hover:underline cursor-pointer disabled:opacity-50"
                            >
                              {isDeleting === photo.id ? "..." : "Delete"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-500 pt-6 max-w-md mx-auto relative z-10 flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>Real-time Exhibition Sync</span>
          <span className="text-slate-700">•</span>
          <span>Zero Third-Party Trackers</span>
        </div>
        <p className="text-[10px] text-slate-600">
          Powered by Next.js & Cloudinary Gallery Engine
        </p>
      </footer>
    </div>
  );
}
