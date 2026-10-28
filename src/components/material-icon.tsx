import { FileImage, FileSpreadsheet, FileText, FileVideo, Link2, NotebookPen, Presentation, ClipboardList, File } from "lucide-react";

export function MaterialIcon({ kind, className = "size-4" }: { kind: string; className?: string }) {
  const Icon =
    kind === "pdf" || kind === "docx" || kind === "google_doc"
      ? FileText
      : kind === "pptx" || kind === "google_slides"
        ? Presentation
        : kind === "google_sheet"
          ? FileSpreadsheet
          : kind === "image"
            ? FileImage
            : kind === "video"
              ? FileVideo
              : kind === "link"
                ? Link2
                : kind === "form"
                  ? ClipboardList
                  : kind === "text"
                    ? NotebookPen
                    : File;
  return <Icon className={className} strokeWidth={1.6} aria-hidden />;
}
