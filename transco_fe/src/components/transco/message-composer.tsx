import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Mic, Paperclip, Send, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ConversationChannel, ConversationMode } from "@/lib/transco/types";

/** Picks whatever audio container the browser's MediaRecorder actually
 * supports — never a fixed "audio/webm", since Safari/iOS only offers
 * mp4/aac. Sent to WhatsApp as a plain audio attachment (type: 'audio'),
 * not converted to OGG/Opus server-side — that conversion is what a
 * real native voice-note bubble needs, deliberately skipped here to
 * avoid the ffmpeg/Railway resource cost that came with it. The
 * customer gets a playable audio file, just not the waveform bubble. */
function pickRecorderMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function extensionFor(mimeType: string): string {
  return mimeType.includes("mp4") ? "m4a" : "webm";
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function MessageComposer({
  mode,
  channel,
  disabled,
  onSend,
  onSendAttachment,
}: {
  mode: ConversationMode;
  /** Attachments are WhatsApp-only for now (see sendAttachment in
   * store.tsx) — the attach button hides itself for a website channel
   * rather than offering something that can't actually be sent. */
  channel?: ConversationChannel | undefined;
  disabled?: boolean;
  onSend: (body: string) => void;
  onSendAttachment?: ((file: File, caption?: string) => Promise<void>) | undefined;
}) {
  const [value, setValue] = useState("");
  const [sendingFile, setSendingFile] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isHuman = mode === "HUMAN";
  const canAttach = isHuman && !disabled && channel !== "website" && !!onSendAttachment;
  // Sending only actually works in HUMAN mode — the backend silently
  // rejects a CHATBOT-mode send with no visible error, so the composer
  // itself must block it here rather than let staff believe a message
  // went out when it didn't.
  const canSend = isHuman && value.trim().length > 0 && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onSendAttachment) return;
    setAttachError(null);
    setSendingFile(true);
    try {
      // Whatever's typed becomes the caption, same as WhatsApp's own
      // attach-and-caption flow.
      await onSendAttachment(file, value.trim() || undefined);
      setValue("");
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Failed to send attachment");
    } finally {
      setSendingFile(false);
    }
  };

  const releaseMicrophone = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const startRecording = async () => {
    setAttachError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setAttachError("Couldn't access the microphone — check your browser's permission for this site.");
    }
  };

  const cancelRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    releaseMicrophone();
    setRecording(false);
  };

  const stopAndSendRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    recorder.onstop = async () => {
      releaseMicrophone();
      setRecording(false);
      const chunks = recordedChunksRef.current;
      recordedChunksRef.current = [];
      if (!onSendAttachment || chunks.length === 0) return;
      const mimeType = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: mimeType });
      const file = new File([blob], `voice-message.${extensionFor(mimeType)}`, { type: mimeType });
      setAttachError(null);
      setSendingFile(true);
      try {
        await onSendAttachment(file);
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : "Failed to send voice message");
      } finally {
        setSendingFile(false);
      }
    };
    recorder.stop();
    mediaRecorderRef.current = null;
  };

  return (
    <div
      className={cn(
        "border-t px-3 py-2.5",
        isHuman ? "border-human-border bg-human-tint" : "border-border bg-panel",
      )}
    >
      {recording ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Cancel recording"
            title="Discard recording"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-md border border-human-border bg-panel px-3 py-2 text-sm">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
            <span className="text-foreground">Recording voice message…</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{formatSeconds(recordingSeconds)}</span>
          </div>
          <button
            type="button"
            onClick={stopAndSendRecording}
            aria-label="Stop and send voice message"
            title="Stop and send"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-human text-human-foreground transition-colors hover:brightness-95"
          >
            <Square className="h-3.5 w-3.5" fill="currentColor" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          {canAttach && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,.pdf,.doc,.docx"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sendingFile}
                aria-label="Attach a file"
                title="Attach a flyer, photo, video, or document"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-human-foreground transition-colors hover:bg-human-soft disabled:opacity-40"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={startRecording}
                disabled={sendingFile}
                aria-label="Record a voice message"
                title="Record a voice message"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-human-foreground transition-colors hover:bg-human-soft disabled:opacity-40"
              >
                <Mic className="h-4 w-4" />
              </button>
            </>
          )}
          <textarea
            rows={1}
            value={value}
            disabled={disabled || !isHuman}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              isHuman ? "Type a message as staff…" : "Switch to Staff to type a message…"
            }
            aria-label="Message"
            className={cn(
              "max-h-32 min-h-9 flex-1 resize-none rounded-md border bg-panel px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60",
              isHuman ? "border-human-border focus:border-human" : "border-input focus:border-ring",
            )}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-40",
              isHuman
                ? "bg-human text-human-foreground hover:brightness-95"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      )}
      {attachError && <p className="mt-1.5 text-[10px] text-destructive">⚠️ {attachError}</p>}
      {sendingFile && <p className="mt-1.5 text-[10px] text-muted-foreground">Sending…</p>}
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {isHuman
          ? "Enter to send · Shift+Enter for a new line"
          : "This conversation is handled by the chatbot. Switch to Staff to reply."}
      </p>
    </div>
  );
}
