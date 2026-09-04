"use client";

import { useState, useEffect, useCallback, useRef, useReducer } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ReviewLayout } from "@/components/review/review-layout";
import { ReviewSidebar } from "@/components/review/review-sidebar";
import { ReviewRightPanel } from "@/components/review/review-right-panel";
import { VideoPlayer } from "@/components/review/video-player";
import { VideoControls } from "@/components/review/video-controls";
import { Timeline } from "@/components/review/timeline";
import { AnnotationCanvas } from "@/components/review/annotation-canvas";
import { AnnotationToolbar } from "@/components/review/annotation-toolbar";
import { VersionCompare } from "@/components/review/version-compare";
import { ShareLinkDialog } from "@/components/review/share-link-dialog";
import { KeyboardShortcutsDialog } from "@/components/review/keyboard-shortcuts-dialog";
import { ReviewSkeleton } from "@/components/review/review-skeleton";
import { Video } from "lucide-react";
import {
  type DeliverableVersion,
  type ReviewComment,
  type ShareLink,
  type ReviewAssignment,
  type AnnotationData,
  type AnnotationTool,
  type ReviewStatus,
  playerReducer,
  initialPlayerState,
  ANNOTATION_COLORS,
} from "@/lib/review-types";

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params.id as string;

  // Data state
  const [assignment, setAssignment] = useState<ReviewAssignment | null>(null);
  const [versions, setVersions] = useState<DeliverableVersion[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Player state
  const [playerState, playerDispatch] = useReducer(playerReducer, initialPlayerState);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialVersionSet = useRef(false);

  // Annotation state
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("arrow");
  const [annotationColor, setAnnotationColor] = useState<string>(ANNOTATION_COLORS[4]); // cyan
  const [annotationStrokeWidth, setAnnotationStrokeWidth] = useState(2);
  const [pendingAnnotation, setPendingAnnotation] = useState<AnnotationData | null>(null);

  // UI state
  const [compareMode, setCompareMode] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [visibleAnnotation, setVisibleAnnotation] = useState<AnnotationData | null>(null);

  const currentVersion = versions.find((v) => v.id === currentVersionId) || versions[0];

  // Fetch all data
  const fetchData = useCallback(async () => {
    try {
      const [assignmentRes, versionsRes] = await Promise.all([
        fetch(`/api/assignments/${assignmentId}`),
        fetch(`/api/assignments/${assignmentId}/versions`),
      ]);

      if (!assignmentRes.ok) throw new Error("Assignment not found");

      const assignmentData = await assignmentRes.json();
      setAssignment(assignmentData);
      setUserId(assignmentData._currentUserId || null);

      if (versionsRes.ok) {
        const versionsData = await versionsRes.json();
        setVersions(versionsData);
        // Only set initial version once to avoid re-fetch loops.
        // ?version=<id> (from the assignment detail) wins when it is a live file.
        if (versionsData.length > 0 && !initialVersionSet.current) {
          initialVersionSet.current = true;
          const wanted = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("version") : null;
          const ids = new Set((versionsData as DeliverableVersion[]).map((v) => v.id));
          setCurrentVersionId(
            (wanted && ids.has(wanted) ? wanted : null) ||
              (assignmentData.currentVersionId && ids.has(assignmentData.currentVersionId) ? assignmentData.currentVersionId : null) ||
              versionsData[0].id
          );
        }
      }
    } catch (err) {
      console.error("Failed to load review data:", err);
      toast.error("Failed to load review data");
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  const fetchComments = useCallback(async () => {
    if (!currentVersionId) return;
    try {
      const res = await fetch(
        `/api/assignments/${assignmentId}/comments?versionId=${currentVersionId}`
      );
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch (err) {
      console.error("Failed to fetch comments:", err);
    }
  }, [assignmentId, currentVersionId]);

  const fetchShareLinks = useCallback(async () => {
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/share`);
      if (res.ok) setShareLinks(await res.json());
    } catch {}
  }, [assignmentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Player controls
  const handlePlay = () => {
    videoRef.current?.play();
    playerDispatch({ type: "SET_PLAYING", playing: true });
  };
  const handlePause = () => {
    videoRef.current?.pause();
    playerDispatch({ type: "SET_PLAYING", playing: false });
  };
  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      playerDispatch({ type: "SET_TIME", time });
    }
  };
  const handleSetRate = (rate: number) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    playerDispatch({ type: "SET_RATE", rate });
  };
  const handleSetVolume = (volume: number) => {
    if (videoRef.current) videoRef.current.volume = volume;
    playerDispatch({ type: "SET_VOLUME", volume });
  };
  const handleToggleMute = () => {
    if (videoRef.current) videoRef.current.muted = !playerState.muted;
    playerDispatch({ type: "SET_MUTED", muted: !playerState.muted });
  };
  const handleToggleFullscreen = () => {
    const container = videoRef.current?.parentElement?.parentElement;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      playerDispatch({ type: "SET_FULLSCREEN", fullscreen: false });
    } else {
      container.requestFullscreen();
      playerDispatch({ type: "SET_FULLSCREEN", fullscreen: true });
    }
  };

  // Comment actions
  const handleSubmitComment = async (data: {
    body: string;
    timecodeSeconds: number | null;
    annotation: AnnotationData | null;
    isInternal: boolean;
    guestName: string | null;
    parentCommentId?: string;
  }) => {
    if (!currentVersionId) return;
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableVersionId: currentVersionId,
          ...data,
        }),
      });
      if (!res.ok) throw new Error("Failed to post comment");
      await fetchComments();
      setPendingAnnotation(null);
      toast.success("Comment added");
    } catch (err) {
      toast.error("Failed to add comment");
    }
  };

  const handleResolveComment = async (commentId: string, resolved: boolean) => {
    try {
      await fetch(
        `/api/assignments/${assignmentId}/comments/${commentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isResolved: resolved }),
        }
      );
      await fetchComments();
    } catch {
      toast.error("Failed to update comment");
    }
  };

  const handleReactToComment = async (
    commentId: string,
    emoji: string
  ) => {
    try {
      const comment = comments
        .flatMap((c) => [c, ...(c.replies || [])])
        .find((c) => c.id === commentId);
      if (!comment) return;

      const reactions = { ...comment.reactions };
      const users = reactions[emoji] || [];
      if (userId && users.includes(userId)) {
        reactions[emoji] = users.filter((u) => u !== userId);
      } else if (userId) {
        reactions[emoji] = [...users, userId];
      }

      await fetch(
        `/api/assignments/${assignmentId}/comments/${commentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reactions }),
        }
      );
      await fetchComments();
    } catch {
      toast.error("Failed to react");
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await fetch(
        `/api/assignments/${assignmentId}/comments/${commentId}`,
        { method: "DELETE" }
      );
      await fetchComments();
      toast.success("Comment deleted");
    } catch {
      toast.error("Failed to delete comment");
    }
  };

  // Version actions
  const handleVersionSelect = (versionId: string) => {
    setCurrentVersionId(versionId);
    setComments([]);
  };

  const handleUploadNewVersion = async (file: File) => {
    try {
      // 1. Presign
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
          assignmentId,
          purpose: "deliverable",
        }),
      });
      if (!presignRes.ok) throw new Error("Failed to get upload URL");
      const { uploadUrl, publicUrl, key } = await presignRes.json();

      // 2. Upload to R2
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");

      // 3. Create version
      const versionRes = await fetch(
        `/api/assignments/${assignmentId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            r2Key: key,
            r2Url: publicUrl,
            filename: file.name,
            contentType: file.type,
            fileSize: file.size,
          }),
        }
      );
      if (!versionRes.ok) throw new Error("Failed to create version");
      const newVersion = await versionRes.json();
      setCurrentVersionId(newVersion.id);
      await fetchData();
      toast.success(newVersion.replaced ? `Uploaded — replaces ${newVersion.replaced.filename}` : "File uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
  };

  // File status: approve / request revision on the selected file only.
  // The assignment moves separately (handleAssignmentStatusChange).
  const handleStatusChange = async (status: ReviewStatus, note?: string | null) => {
    if (!currentVersionId) return;
    try {
      const res = await fetch(
        `/api/assignments/${assignmentId}/versions/${currentVersionId}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewStatus: status, ...(note !== undefined ? { reviewNote: note } : {}) }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update file status");
      }
      await fetchData();
      toast.success(
        status === "approved" ? "File approved" : status === "needs_review" ? "Revision requested on this file" : "File status cleared"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  // Assignment status: send the revision (server composes the text from the
  // flagged files' notes + timecoded comments) or mark it ready for upload.
  const handleAssignmentStatusChange = async (status: "REVISION" | "READY_FOR_POSTING", feedback?: string) => {
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(feedback ? { revisionFeedback: feedback } : {}) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update assignment");
      }
      await fetchData();
      toast.success(status === "REVISION" ? "Revision sent to the editor" : "Ready for upload to Meta");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update assignment");
    }
  };

  // Share links
  const handleCreateShareLink = async (data: {
    password: string | null;
    expiresAt: string | null;
    allowComments: boolean;
  }) => {
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create share link");
      await fetchShareLinks();
      toast.success("Share link created");
    } catch {
      toast.error("Failed to create share link");
    }
  };

  const handleRevokeShareLink = async (linkId: string) => {
    try {
      await fetch(`/api/assignments/${assignmentId}/share/${linkId}`, {
        method: "DELETE",
      });
      await fetchShareLinks();
      toast.success("Share link revoked");
    } catch {
      toast.error("Failed to revoke share link");
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        // Allow Cmd+Enter in textarea
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          // Handled by comment-input
        }
        return;
      }

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          playerState.playing ? handlePause() : handlePlay();
          break;
        case "j":
          e.preventDefault();
          handleSeek(Math.max(0, playerState.currentTime - 10));
          break;
        case "l":
          e.preventDefault();
          handleSeek(
            Math.min(playerState.duration, playerState.currentTime + 10)
          );
          break;
        case ",":
          e.preventDefault();
          handleSeek(Math.max(0, playerState.currentTime - 1 / 30));
          break;
        case ".":
          e.preventDefault();
          handleSeek(
            Math.min(playerState.duration, playerState.currentTime + 1 / 30)
          );
          break;
        case "[":
          e.preventDefault();
          handleSetRate(Math.max(0.25, playerState.playbackRate - 0.25));
          break;
        case "]":
          e.preventDefault();
          handleSetRate(Math.min(2, playerState.playbackRate + 0.25));
          break;
        case "f":
          e.preventDefault();
          handleToggleFullscreen();
          break;
        case "a":
          e.preventDefault();
          setAnnotationMode((prev) => !prev);
          break;
        case "c":
          e.preventDefault();
          document
            .querySelector<HTMLTextAreaElement>("[data-comment-input]")
            ?.focus();
          break;
        case "Escape":
          if (annotationMode) {
            setAnnotationMode(false);
            setPendingAnnotation(null);
          }
          break;
        case "?":
          e.preventDefault();
          setShortcutsOpen(true);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playerState, annotationMode]);

  if (loading) return <ReviewSkeleton />;
  if (!assignment) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white mb-2">
            Assignment not found
          </h2>
          <button
            onClick={() => router.push("/review")}
            className="text-cyan-400 hover:underline text-sm"
          >
            Back to Review Queue
          </button>
        </div>
      </div>
    );
  }

  if (compareMode) {
    return (
      <VersionCompare
        versions={versions}
        onClose={() => setCompareMode(false)}
      />
    );
  }

  const mediaUrl = currentVersion?.r2Url || assignment.deliverableUrl;
  const contentType = currentVersion?.contentType || "video/mp4";
  const isImage = contentType.startsWith("image/");

  return (
    <>
      <ReviewLayout
        left={
          <ReviewSidebar
            assignment={assignment}
            versions={versions}
            currentVersion={currentVersion || null}
            onVersionSelect={handleVersionSelect}
            onStatusChange={handleStatusChange}
            onAssignmentStatusChange={handleAssignmentStatusChange}
            onUploadNew={() => fileInputRef.current?.click()}
            onShareLink={() => {
              fetchShareLinks();
              setShareDialogOpen(true);
            }}
            onCompare={() => setCompareMode(true)}
          />
        }
        center={
          <div className="relative flex flex-col h-full">
            <div className="relative flex-1 bg-black rounded-lg overflow-hidden">
              {mediaUrl ? (
                <>
                  <VideoPlayer
                    ref={videoRef}
                    src={mediaUrl}
                    contentType={contentType}
                    posterUrl={currentVersion?.thumbnailUrl || undefined}
                    onTimeUpdate={(time) =>
                      playerDispatch({ type: "SET_TIME", time })
                    }
                    onDurationChange={(dur) =>
                      playerDispatch({ type: "SET_DURATION", duration: dur })
                    }
                    onPlay={() =>
                      playerDispatch({ type: "SET_PLAYING", playing: true })
                    }
                    onPause={() =>
                      playerDispatch({ type: "SET_PLAYING", playing: false })
                    }
                    onBufferUpdate={(buffered) =>
                      playerDispatch({ type: "SET_BUFFERED", buffered })
                    }
                  >
                    <AnnotationCanvas
                      tool={annotationTool}
                      color={annotationColor}
                      strokeWidth={annotationStrokeWidth}
                      isDrawing={annotationMode}
                      onAnnotationComplete={(annotation) => {
                        setPendingAnnotation(annotation);
                        setAnnotationMode(false);
                      }}
                      savedAnnotations={
                        visibleAnnotation ? [visibleAnnotation] : []
                      }
                      onStartDrawing={() => {
                        if (playerState.playing) handlePause();
                      }}
                    />
                  </VideoPlayer>

                  <AnnotationToolbar
                    activeTool={annotationTool}
                    activeColor={annotationColor}
                    activeStrokeWidth={annotationStrokeWidth}
                    onToolChange={setAnnotationTool}
                    onColorChange={setAnnotationColor}
                    onStrokeWidthChange={setAnnotationStrokeWidth}
                    onClear={() => setPendingAnnotation(null)}
                    onCancel={() => {
                      setAnnotationMode(false);
                      setPendingAnnotation(null);
                    }}
                    isActive={annotationMode}
                  />
                </>
              ) : (
                <div className="flex items-center justify-center h-full min-h-[300px] text-slate-500">
                  <div className="text-center">
                    <Video className="h-12 w-12 mx-auto mb-2 text-slate-700" />
                    <p>No deliverable uploaded yet</p>
                  </div>
                </div>
              )}
            </div>

            {/* Timeline + Controls */}
            {mediaUrl && !isImage && (
              <div className="mt-2 space-y-1">
                <Timeline
                  currentTime={playerState.currentTime}
                  duration={playerState.duration}
                  buffered={playerState.buffered}
                  comments={comments}
                  currentUserId={userId || undefined}
                  onSeek={handleSeek}
                  onCommentClick={(comment) => {
                    if (comment?.timecodeSeconds != null) {
                      handleSeek(comment.timecodeSeconds);
                    }
                  }}
                />
                <VideoControls
                  playerState={playerState}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onSeek={handleSeek}
                  onSetRate={handleSetRate}
                  onSetVolume={handleSetVolume}
                  onToggleMute={handleToggleMute}
                  onToggleFullscreen={handleToggleFullscreen}
                />
              </div>
            )}
          </div>
        }
        right={
          <ReviewRightPanel
            assignment={assignment}
            comments={comments}
            currentTimecode={
              !playerState.playing ? playerState.currentTime : undefined
            }
            annotation={pendingAnnotation}
            currentUserId={userId || undefined}
            onSubmitComment={handleSubmitComment}
            onSeek={(time) => {
              handleSeek(time);
              setVisibleAnnotation(null);
            }}
            onShowAnnotation={(comment) => {
              if (comment.annotation) {
                setVisibleAnnotation(comment.annotation);
                setTimeout(() => setVisibleAnnotation(null), 5000);
              }
            }}
            onResolve={handleResolveComment}
            onReact={handleReactToComment}
            onDeleteComment={handleDeleteComment}
          />
        }
      />

      <ShareLinkDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        assignmentId={assignmentId}
        shareLinks={shareLinks}
        onCreateLink={handleCreateShareLink}
        onRevokeLink={handleRevokeShareLink}
      />

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />

      {/* Hidden file input for uploading new versions */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadNewVersion(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
