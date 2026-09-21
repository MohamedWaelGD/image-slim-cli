import { basename } from "node:path";
import type {
  ProgressEvent,
  ProgressHandler,
  ProgressMode,
} from "../types/public";

const BAR_WIDTH = 24;

function progressBar(completed: number, total: number): string {
  const ratio = total === 0 ? 1 : Math.min(1, completed / total);
  const filled = Math.round(ratio * BAR_WIDTH);
  return `[${"#".repeat(filled)}${"-".repeat(BAR_WIDTH - filled)}]`;
}

function percentage(completed: number, total: number): string {
  return `${total === 0 ? 100 : Math.round((completed / total) * 100)}%`;
}

export function shouldShowProgress(
  mode: ProgressMode,
  report: "text" | "json",
  quiet: boolean,
  isTTY: boolean | undefined,
): boolean {
  if (quiet || mode === "never") return false;
  if (mode === "always") return true;
  return Boolean(isTTY) && report === "text";
}

export class ProgressRenderer {
  private line = "";
  private spinnerIndex = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly stream: NodeJS.WriteStream) {}

  start(): void {
    this.stream.write("\x1b[?25l");
    this.render("Discovering images");
    this.timer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % 4;
      this.render(`Discovering images ${"|/-\\"[this.spinnerIndex]}`);
    }, 120);
  }

  handle: ProgressHandler = (event: ProgressEvent): void => {
    if (event.phase === "discovering") {
      this.render("Discovering images");
      return;
    }
    if (event.phase === "discovered") {
      this.render(`Found ${event.total} images`);
      return;
    }
    if (event.phase === "optimizing") {
      if (event.status === "started") {
        this.render(
          `Optimizing ${progressBar(event.completed, event.total)} ${event.completed}/${event.total} ${percentage(event.completed, event.total)} ${basename(event.file)}`,
        );
      } else {
        this.render(
          `Optimizing ${progressBar(event.completed, event.total)} ${event.completed}/${event.total} ${percentage(event.completed, event.total)} ${basename(event.file)}`,
        );
      }
      return;
    }
    if (event.phase === "references") {
      this.render(
        `Scanning references ${progressBar(event.completed, event.total)} ${event.completed}/${event.total} ${percentage(event.completed, event.total)} ${basename(event.file)}`,
      );
    }
  };

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.line) this.stream.write("\r\x1b[2K\x1b[?25h\n");
    else this.stream.write("\x1b[?25h");
    this.line = "";
  }

  private render(line: string): void {
    this.line = line;
    this.stream.write(`\r\x1b[2K${line}`);
  }
}
