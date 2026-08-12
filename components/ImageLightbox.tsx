"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ZOOM_STEP = 0.25;

interface ClickableImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  /** Image source: string URL (data:, http(s):, blob:, /api/files/...) or Blob. */
  src: ImgHTMLAttributes<HTMLImageElement>["src"];
}

/**
 * Click-to-preview image: renders the thumbnail inline and opens a full-screen
 * lightbox with zoom controls on click. Accepts any img props (style, className,
 * width, ...) and forwards them to the thumbnail element.
 *
 * Blob sources (part of React 19's img-src union) render through a managed
 * object URL that is revoked when the source changes or the component unmounts
 * — the same mechanism React's experimental `enableSrcObject` will use natively.
 */
export function ClickableImage({ src, alt, ...imgProps }: ClickableImageProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof src === "string" || src === undefined) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(src);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [src]);

  const resolvedSrc = typeof src === "string" ? src : objectUrl ?? "";

  // Never render a broken clickable thumbnail for a missing source.
  if (!resolvedSrc) return null;

  return (
    <>
      <button
        type="button"
        className="image-clickable"
        onClick={(event) => {
          // Linked markdown images (`[![alt](img)](url)`) wrap this button in
          // an anchor; never let the click bubble and navigate away.
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={alt ? t("imagePreview.openWithAlt", { alt }) : t("imagePreview.open")}
        title={alt ? t("imagePreview.openWithAlt", { alt }) : t("imagePreview.open")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resolvedSrc} alt={alt ?? ""} loading="lazy" {...imgProps} />
      </button>
      {/*
        Portal to <body>: a linked markdown image (`[![alt](img)](url)`) would
        otherwise keep the dialog inside the anchor, so clicks on the viewer
        (zoom, close) would bubble into anchor navigation. The dialog only
        renders when `open`, which is strictly client-side — the short-circuit
        keeps `document.body` off the SSR path.
      */}
      {open && createPortal(<ImageLightbox src={resolvedSrc} alt={alt ?? ""} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function ImageLightbox({ src, alt, onClose }: { src: ClickableImageProps["src"]; alt: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);
  const { t } = useI18n();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="image-lightbox-dialog"
      aria-label={t("imagePreview.viewerLabel")}
      onClick={(event) => {
        // createPortal moves the DOM to <body>, but React synthetic events
        // still bubble through the component tree: without this, clicks on
        // viewer controls would reach a wrapping anchor's onClick (mixed
        // markdown links like `[text ![img]](file)`) and open its target.
        event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // stopPropagation: the app's window-level Escape handler aborts a
        // running agent — closing the lightbox must not also stop it.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="image-lightbox-layout">
        <div className="image-lightbox-toolbar">
          <span className="image-lightbox-title">{alt || t("imagePreview.imageTitle")}</span>
          <div className="image-lightbox-actions">
            <div className="image-lightbox-stepper">
              <button
                type="button"
                onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - ZOOM_STEP))}
                disabled={zoom <= ZOOM_MIN}
                title={t("imagePreview.zoomOut")}
                aria-label={t("imagePreview.zoomOut")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M5 12h14" />
                </svg>
              </button>
              <span className="image-lightbox-zoom-value">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + ZOOM_STEP))}
                disabled={zoom >= ZOOM_MAX}
                title={t("imagePreview.zoomIn")}
                aria-label={t("imagePreview.zoomIn")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="image-lightbox-icon-button"
              onClick={() => setZoom(1)}
              title={t("imagePreview.resetZoom")}
              aria-label={t("imagePreview.resetZoom")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
              </svg>
            </button>
            <button
              type="button"
              className="image-lightbox-icon-button"
              onClick={onClose}
              title={t("imagePreview.close")}
              aria-label={t("imagePreview.close")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div
          className="image-lightbox-viewport"
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="image-lightbox-img"
            style={{ zoom }}
          />
        </div>
      </div>
    </dialog>
  );
}
