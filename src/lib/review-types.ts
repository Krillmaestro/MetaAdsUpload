// ─── Review System Types ────────────────────────────────────────────────────

export type AnnotationTool = "arrow" | "rectangle" | "freehand" | "ellipse";

export type AnnotationData = {
  type: AnnotationTool;
  color: string; // hex
  strokeWidth: number;
  points: Array<{ x: number; y: number }>; // normalized 0-1
  frameWidth: number;
  frameHeight: number;
};

export type ReviewStatus = "no_status" | "in_progress" | "needs_review" | "approved";

export interface DeliverableVersion {
  id: string;
  assignmentId: string;
  versionNumber: number;
  r2Key: string;
  r2Url: string;
  filename: string;
  contentType: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  thumbnailR2Key: string | null;
  thumbnailUrl: string | null;
  uploadedById: string;
  uploadedBy?: { id: string; name: string };
  reviewStatus: ReviewStatus;
  commentCount?: number;
  createdAt: string;
  // One row per FILE (hook). A revision replaces the file: the old row gets
  // replacedById/deletedAt and drops out of the active list.
  hookLabel?: string | null;
  reviewNote?: string | null;
  replacedById?: string | null;
  replacedAt?: string | null;
  deletedAt?: string | null;
  metaAdId?: string | null;
  comments?: Array<{ id: string; timecodeSeconds: number | null; body: string; author: string; isResolved: boolean; createdAt: string }>;
}

/** "H2 · v2", or the filename when the file has no hook label. */
export function fileLabel(v: Pick<DeliverableVersion, "hookLabel" | "versionNumber" | "filename">): string {
  return v.hookLabel ? `${v.hookLabel} · v${v.versionNumber}` : `${v.filename.replace(/\.[^.]+$/, "")} · v${v.versionNumber}`;
}

export const hookOrder = (label: string | null | undefined) => (label ? parseInt(label.slice(1), 10) || 999 : 999);

export interface ReviewComment {
  id: string;
  deliverableVersionId: string;
  parentCommentId: string | null;
  authorId: string | null;
  author?: { id: string; name: string } | null;
  guestName: string | null;
  body: string;
  timecodeSeconds: number | null;
  annotation: AnnotationData | null;
  isInternal: boolean;
  isResolved: boolean;
  reactions: Record<string, string[]>;
  mentionedUserIds: string[];
  replies?: ReviewComment[];
  createdAt: string;
  updatedAt: string;
}

export interface ShareLink {
  id: string;
  assignmentId: string;
  token: string;
  password: string | null;
  expiresAt: string | null;
  createdById: string;
  createdBy?: { id: string; name: string };
  allowComments: boolean;
  isActive: boolean;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
}

export interface ReviewAssignment {
  id: string;
  title: string;
  autoName: string | null;
  batchNumber: number;
  status: string;
  priority: string;
  assignedTo: { id: string; name: string };
  format: { id: string; name: string } | null;
  product: { id: string; name: string } | null;
  angle: { id: string; name: string } | null;
  deliverableUrl: string | null;
  currentVersionId: string | null;
  dueDate: string | null;
  createdAt: string;
}

// Player state
export interface PlayerState {
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  isFullscreen: boolean;
  buffered: number;
}

export type PlayerAction =
  | { type: "SET_PLAYING"; playing: boolean }
  | { type: "SET_TIME"; time: number }
  | { type: "SET_DURATION"; duration: number }
  | { type: "SET_VOLUME"; volume: number }
  | { type: "SET_MUTED"; muted: boolean }
  | { type: "SET_RATE"; rate: number }
  | { type: "SET_FULLSCREEN"; fullscreen: boolean }
  | { type: "SET_BUFFERED"; buffered: number };

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "SET_PLAYING": return { ...state, playing: action.playing };
    case "SET_TIME": return { ...state, currentTime: action.time };
    case "SET_DURATION": return { ...state, duration: action.duration };
    case "SET_VOLUME": return { ...state, volume: action.volume, muted: action.volume === 0 };
    case "SET_MUTED": return { ...state, muted: action.muted };
    case "SET_RATE": return { ...state, playbackRate: action.rate };
    case "SET_FULLSCREEN": return { ...state, isFullscreen: action.fullscreen };
    case "SET_BUFFERED": return { ...state, buffered: action.buffered };
    default: return state;
  }
}

export const initialPlayerState: PlayerState = {
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  playbackRate: 1,
  isFullscreen: false,
  buffered: 0,
};

// Timecode formatting
export function formatTimecode(seconds: number, fps = 30): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

export function formatTimeSimple(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Annotation colors
export const ANNOTATION_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#ffffff", // white
] as const;

// Reaction emojis
export const REACTION_EMOJIS = ["👍", "❤️", "🔥", "👀", "👏", "✅"] as const;
