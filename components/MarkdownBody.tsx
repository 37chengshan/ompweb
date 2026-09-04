"use client";

import { Children, cloneElement, isValidElement, useMemo, type ComponentProps, type MouseEvent, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { normalizeDisplayMath, useMarkdownPlugins } from "../lib/markdown";
import { markdownCodeRenderer } from "./MarkdownCode";
import { ClickableImage } from "./ImageLightbox";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile }: MarkdownBodyProps) {
  // Skip normalizeDisplayMath while streaming: it scans the entire document
  // on every token batch but math content almost never arrives mid-stream.
  // The normalization runs once on the final committed message instead.
  const normalizedMarkdown = useMemo(
    () => (isStreaming ? children : normalizeDisplayMath(children)),
    [children, isStreaming],
  );
  const { remarkPlugins, rehypePlugins } = useMarkdownPlugins(isStreaming ? "" : normalizedMarkdown, isStreaming);

  // Rebuilt only when its captured props change, not on every render.
  const components = useMemo<Components>(() => {
    const imgComponent = ({ src, alt, ...imgProps }: ComponentProps<"img"> & { node?: unknown }) => {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete (imgProps as { node?: unknown }).node;
      // react-markdown URL-encodes drive-letter srcs; resolveLocalFileHref
      // decodes them back before resolving.
      const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
      const imageSrc = filePath
        ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
        : src;
      // Dynamic local paths are served directly by the file API.
      return <ClickableImage src={imageSrc} alt={alt ?? ""} loading="lazy" {...imgProps} />;
    };

    /**
     * Split link children into linked text and previewable images. Images may
     * sit directly or wrapped in formatting (`[**![img](x)**](url)`); a
     * <button> can never nest inside an <a>, so image content is extracted
     * while text (with its formatting) stays linked.
     */
    const isElementWithChildren = (value: unknown): value is ReactElement<{ children?: ReactNode }> => isValidElement(value);
    const partitionLinkContent = (node: ReactNode): { textParts: ReactNode[]; imageParts: ReactNode[] } => {
      const textParts: ReactNode[] = [];
      const imageParts: ReactNode[] = [];
      for (const child of Children.toArray(node)) {
        if (!isElementWithChildren(child)) {
          textParts.push(child);
          continue;
        }
        if (child.type === imgComponent) {
          imageParts.push(child);
          continue;
        }
        const sub = partitionLinkContent(child.props.children);
        if (sub.imageParts.length === 0) {
          textParts.push(child);
        } else if (sub.textParts.length === 0) {
          // Formatting wrapper containing only images moves to the previews.
          imageParts.push(child);
        } else {
          // Mixed wrapper: keep the wrapper with its text, extract the images.
          textParts.push(cloneElement(child, undefined, sub.textParts));
          imageParts.push(...sub.imageParts);
        }
      }
      return { textParts, imageParts };
    };
    /** True when any text part carries non-whitespace content. */
    const hasMeaningfulText = (parts: ReactNode[]): boolean =>
      parts.some((part) => {
        if (typeof part === "string") return part.trim().length > 0;
        if (typeof part === "number") return true;
        if (isElementWithChildren(part)) return hasMeaningfulText(Children.toArray(part.props.children));
        return false;
      });

    return {
    code: markdownCodeRenderer({ isStreaming, inlineClassName: "markdown-inline-code" }),
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      // react-markdown URL-encodes drive-letter hrefs (C:%5CUsers...);
      // resolveLocalFileHref decodes them back before resolving.
      const { textParts, imageParts } = partitionLinkContent(children);
      // A <button> cannot nest inside an <a>. Pure image links (direct or
      // wrapped in formatting, possibly with surrounding whitespace) render
      // only the previews — the lightbox supersedes the link. Mixed links
      // keep their text linked and render image previews beside the anchor.
      if (imageParts.length > 0 && !hasMeaningfulText(textParts)) {
        return <>{children}</>;
      }
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (filePath && openFile) {
        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (event.defaultPrevented || event.button !== 0) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          const target = event.currentTarget.getAttribute("target");
          if (target && target !== "_self") return;
          event.preventDefault();
          openFile(filePath);
        };
        const anchor = <a {...props} href={href} onClick={handleClick}>{textParts}</a>;
        return imageParts.length > 0 ? <>{anchor}{imageParts}</> : anchor;
      }

      const anchor = (
        <a {...props} href={href} target="_blank" rel="noopener noreferrer">
          {textParts}
        </a>
      );
      return imageParts.length > 0 ? <>{anchor}{imageParts}</> : anchor;
    },
    img: imgComponent,
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
    };
  }, [isStreaming, cwd, onOpenFile]);

  return (
    <div className={["markdown-body", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        // Keep drive-letter/UNC paths intact: react-markdown's default
        // urlTransform strips "C:"-style schemes to "", which would break
        // local path resolution. rehype-sanitize still blocks dangerous
        // protocols (javascript:, data:) via its attribute schema.
        urlTransform={(url) => url}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}
