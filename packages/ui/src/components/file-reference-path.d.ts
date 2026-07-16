export type FileReferenceKind = "file" | "directory" | "unknown";
export declare function stripTrailingPathPunctuation(value: string): string;
export declare function isLocalFileHref(value: string): boolean;
export declare function isPathLike(value: string): boolean;
export declare function looksLikeCommand(value: string): boolean;
export declare function inferFileReferenceKind(value: string): FileReferenceKind;
export declare function resolveFileReferencePath(value: string, baseDir?: string): string | undefined;
export declare function getParentPath(value: string): string | undefined;
export declare function getPlainTextPathMatch(text: string, startIndex?: number): {
    value: string;
    start: number;
    end: number;
} | undefined;
