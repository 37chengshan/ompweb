"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export function isAttachableDragItem(item: Pick<DataTransferItem, "kind">): boolean {
  // Finder and Windows Explorer assign platform-specific (and occasionally
  // misleading) MIME types during a drag: .json can be application/json and
  // .ts can be video/mp2t. The composer already validates each File after the
  // drop, so the drag affordance must key off the reliable file-vs-text signal
  // rather than a MIME allow-list.
  return item.kind === "file";
}

export function useDragDrop(onDrop: (files: File[]) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  const counterRef = useRef(0);

  // A drag can end outside the drop target (release over browser chrome, ESC,
  // OS-level cancel) with no balancing dragleave, which would leave the
  // overlay stuck visible until the next drag cycle. Reset on any window-level
  // drop/dragend — handleDrop's own reset stays, this covers the rest.
  useEffect(() => {
    const reset = () => {
      counterRef.current = 0;
      setIsDragOver(false);
    };
    window.addEventListener("drop", reset);
    window.addEventListener("dragend", reset);
    return () => {
      window.removeEventListener("drop", reset);
      window.removeEventListener("dragend", reset);
    };
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    const hasAttachables = Array.from(e.dataTransfer.items).some(isAttachableDragItem);
    if (!hasAttachables) return;
    e.preventDefault();
    counterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasAttachables = Array.from(e.dataTransfer.items).some(isAttachableDragItem);
    if (!hasAttachables) return;
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback(() => {
    counterRef.current -= 1;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    onDrop(files);
  }, [onDrop]);

  return { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop };
}
