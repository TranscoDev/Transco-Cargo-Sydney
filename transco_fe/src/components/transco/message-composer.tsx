import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Paperclip, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ConversationChannel, ConversationMode } from "@/lib/transco/types";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  return (
    <div
      className={cn(
        "border-t px-3 py-2.5",
        isHuman ? "border-human-border bg-human-tint" : "border-border bg-panel",
      )}
    >
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
      {attachError && <p className="mt-1.5 text-[10px] text-destructive">⚠️ {attachError}</p>}
      {sendingFile && <p className="mt-1.5 text-[10px] text-muted-foreground">Sending attachment…</p>}
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {isHuman
          ? "Enter to send · Shift+Enter for a new line"
          : "This conversation is handled by the chatbot. Switch to Staff to reply."}
      </p>
    </div>
  );
}
