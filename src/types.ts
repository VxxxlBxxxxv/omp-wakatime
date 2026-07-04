export type SourceEvent =
  | "SessionStart"
  | "PostToolUse"
  | "SessionEnd";

export type HeartbeatState = {
  lastHeartbeatAt?: number;
};

export type FileHeartbeatRequest = {
  type: "file";
  entity: string;
  projectFolder: string;
  category?: string;
  isWrite?: boolean;
  lineChanges?: number;
  sourceEvent?: SourceEvent;
};

export type SessionHeartbeatRequest = {
  type: "session";
  entity: string;
  projectFolder: string;
  category?: string;
  stateKey: string;
  sourceEvent?: SourceEvent;
};

export type HeartbeatRequest = FileHeartbeatRequest | SessionHeartbeatRequest;

export type EditDetails = {
  diff?: string;
  path?: string;
  perFileResults?: Array<{
    path: string;
    diff?: string;
    isError?: boolean;
  }>;
  files?: string[];
  fileReplacements?: Array<{ path: string; count: number }>;
};

export type AstEditDetails = {
  totalReplacements?: number;
  filesTouched?: number;
  filesSearched?: number;
  applied?: boolean;
  files?: string[];
  fileReplacements?: Array<{ path: string; count: number }>;
};
